import {
  appConfigPatchSchema,
  appConfigSchema,
  appConfigSectionsSchema,
  type AppConfig,
  type AppConfigSections
} from "@ink-agent/contracts";
import { badRequest, conflict } from "../utils/errors.js";
import { ConfigRepository } from "./configRepository.js";
import { defaultAppConfig } from "./defaultAppConfig.js";
import { projectEffectiveConfig } from "./configProjection.js";

type ConfigSection = keyof AppConfigSections;

/**
 * 递归合并 patch 到 base：对象逐层合并，其余值直接替换。
 * 保证局部更新（如只改 runtime.globalConcurrency）不会丢失同层其他字段。
 */
function mergeObjects<T>(base: T, patch: unknown): T {
  if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
    return patch as T;
  }

  const next = { ...(base as Record<string, unknown>) };

  for (const [key, value] of Object.entries(patch)) {
    const current = next[key];
    next[key] = typeof current === "object" && current !== null && !Array.isArray(current)
      ? mergeObjects(current, value)
      : value;
  }

  return next as T;
}

/**
 * 公共配置服务：内存态配置 + 乐观锁更新。
 * 所有修改通过 mutationQueue 串行执行，避免并发 PATCH 竞争 revision 检查。
 */
export class ConfigService {
  /** 内存中的当前配置；null 表示尚未初始化（或读取失败）。 */
  private current: AppConfig | null = null;
  /** 串行化所有写操作，保证 revision 检查与落盘之间不穿插其他修改。 */
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly repository: ConfigRepository) {}

  /** 启动时初始化：加载配置到内存并返回。 */
  async initialize() {
    this.current = await this.repository.readOrCreate();
    return this.get();
  }

  /** 获取当前配置的深拷贝，防止调用方修改内存态。 */
  async get() {
    if (!this.current) {
      this.current = await this.repository.readOrCreate();
    }

    return structuredClone(this.current);
  }

  /** 返回生效配置投影（含 configHash 与重启字段标记）。 */
  async getEffective() {
    return projectEffectiveConfig(await this.get());
  }

  /**
   * 乐观锁更新配置。
   * expectedRevision 必须等于当前 revision，否则抛 409 冲突；
   * 成功后 revision +1 并落盘，返回新的生效配置投影。
   */
  async update(body: unknown) {
    const input = appConfigPatchSchema.parse(body);
    return this.enqueueMutation(async () => {
      const current = await this.get();

      if (input.expectedRevision !== current.revision) {
        throw conflict("配置已被其他操作修改，请刷新后重试", {
          expectedRevision: input.expectedRevision,
          actualRevision: current.revision
        });
      }

      const candidate = appConfigSchema.parse({
        ...mergeObjects(current, input.changes),
        schemaVersion: current.schemaVersion,
        revision: current.revision + 1
      });
      this.current = await this.repository.write(candidate);
      return projectEffectiveConfig(this.current);
    });
  }

  /** 校验变更而不落盘：返回如果应用该变更后的生效配置投影。 */
  async validate(changes: unknown) {
    const current = await this.get();
    const parsedChanges = appConfigSectionsSchema.deepPartial().parse(changes);
    const candidate = appConfigSchema.parse({
      ...mergeObjects(current, parsedChanges),
      schemaVersion: current.schemaVersion,
      revision: current.revision
    });
    return projectEffectiveConfig(candidate);
  }

  /**
   * 将指定分区恢复为默认值。
   * 未知分区直接抛 400；内部复用 update 走 revision 检查与落盘。
   */
  async resetSection(section: string, expectedRevision: number) {
    if (!(section in defaultAppConfig)) {
      throw badRequest(`未知配置分区：${section}`);
    }

    const sectionName = section as ConfigSection;
    return this.update({
      expectedRevision,
      changes: { [sectionName]: defaultAppConfig[sectionName] }
    });
  }

  /** 从磁盘重新加载配置（用于用户手工编辑文件后热生效）。 */
  async reload() {
    this.current = await this.repository.readOrCreate();
    return projectEffectiveConfig(this.current);
  }

  /**
   * 串行化写操作：新任务挂在队列尾，队列只保留最新任务的终态，
   * 调用方各自拿到自己任务的 Promise，互不阻塞读取。
   */
  private enqueueMutation<T>(task: () => Promise<T>) {
    const result = this.mutationQueue.then(task, task);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
