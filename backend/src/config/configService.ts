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

export class ConfigService {
  private current: AppConfig | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly repository: ConfigRepository) {}

  async initialize() {
    this.current = await this.repository.readOrCreate();
    return this.get();
  }

  async get() {
    if (!this.current) {
      this.current = await this.repository.readOrCreate();
    }

    return structuredClone(this.current);
  }

  async getEffective() {
    return projectEffectiveConfig(await this.get());
  }

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

  async reload() {
    this.current = await this.repository.readOrCreate();
    return projectEffectiveConfig(this.current);
  }

  private enqueueMutation<T>(task: () => Promise<T>) {
    const result = this.mutationQueue.then(task, task);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
