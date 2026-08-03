/**
 * 状态 Patch 服务。
 * 职责：模型对权威状态（章节正文 / 作品文件）的提议 → 审批 → 应用全流程——提议时记录内容哈希基线，
 * 应用前做哈希冲突检测，应用前写备份文件，中途失败自动对账恢复；
 * 边界：应用/拒绝类写操作经进程内队列串行化（mutationQueue），防止并发应用互相覆盖；目标文件在应用后与提议内容不一致时标记 conflicted。
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  statePatchApplyInputSchema,
  statePatchProposalInputSchema,
  statePatchRejectInputSchema,
  type StatePatch,
  type StatePatchTarget
} from "@ink-agent/contracts";
import type { RunEventStore } from "../agents/runEventStore.js";
import { getChapter, updateChapter } from "../books/chapterService.js";
import { getBookFileContent, updateBookFileContent } from "../files/fileService.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { badRequest, conflict } from "../../utils/errors.js";
import { ensureDirectory, writeTextFileAtomic } from "../../utils/fileStore.js";
import { sha256 } from "../../utils/hash.js";
import { resolveInsideRoot } from "../../utils/safePath.js";
import { PatchRepository } from "./patchRepository.js";
import type { ConfigService } from "../../config/configService.js";

export class PatchService {
  /** 进程内写队列：所有应用/拒绝操作按到达顺序执行，避免同一目标并发写。 */
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly paths: WorkspacePaths,
    private readonly repository: PatchRepository,
    private readonly runEventStore: RunEventStore,
    private readonly configService?: Pick<ConfigService, "get">
  ) {}

  /**
   * 提议 Patch：校验大小上限、Run 与作品一致性、内容非空变化，记录当前内容的哈希基线（baseHash）。
   * @returns 状态为 proposed 的 Patch 记录
   */
  async propose(runId: string, body: unknown) {
    const input = statePatchProposalInputSchema.parse(body);
    if (Buffer.byteLength(input.proposedContent, "utf8") > 10 * 1024 * 1024) {
      throw badRequest("Patch 内容不能超过 10 MiB");
    }
    const run = this.runEventStore.getRun(runId);
    if (run.bookId !== input.bookId) {
      throw badRequest("Patch 作品与 Run 作品不一致", { runId, runBookId: run.bookId, patchBookId: input.bookId });
    }
    const currentContent = await this.readTarget(input.bookId, input.target);
    if (currentContent === input.proposedContent) throw badRequest("Patch 内容与当前内容相同");
    const now = new Date().toISOString();
    const patch: StatePatch = {
      schemaVersion: "state-patch.v1",
      id: randomUUID(),
      runId,
      bookId: input.bookId,
      target: input.target,
      status: "proposed",
      reason: input.reason,
      baseHash: sha256(currentContent),
      proposedHash: sha256(input.proposedContent),
      proposedContent: input.proposedContent,
      backupFile: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      appliedAt: null,
      rejectedAt: null
    };
    return this.repository.create(patch);
  }

  /** 按 id 读取 Patch。 */
  get(patchId: string) {
    return this.repository.get(patchId);
  }

  /** 按作品列出 Patch（时间倒序）。 */
  listByBook(bookId: string) {
    return this.repository.listByBook(bookId);
  }

  /**
   * 应用 Patch（proposed → applying → applied）：
   * 审批前校验基线哈希；应用前再次比对目标内容哈希（防并发修改冲突）；
   * 先写备份文件再写目标；写入失败时对账恢复，绝不留下半更新状态。
   */
  apply(patchId: string, body: unknown) {
    const input = statePatchApplyInputSchema.parse(body);
    return this.enqueueMutation(async () => {
      if (this.configService && !(await this.configService.get()).features.patchApply) {
        throw conflict("Patch 应用功能尚未启用", { setting: "features.patchApply" });
      }
      let patch = this.repository.get(patchId);
      if (patch.status === "applied") return patch;
      if (patch.status !== "proposed") {
        throw conflict("只有 proposed Patch 可以应用", { patchId, status: patch.status });
      }
      // 审批防伪：审批请求携带的基线哈希必须与提议时一致
      if (input.expectedBaseHash !== patch.baseHash) {
        throw conflict("审批基线哈希与 Patch 不一致", { patchId });
      }

      const currentContent = await this.readTarget(patch.bookId, patch.target);
      // 应用前哈希比对：目标内容在提议后被其他途径修改 → 标记 conflicted 并拒绝应用
      if (sha256(currentContent) !== patch.baseHash) {
        patch = this.repository.update({
          ...patch,
          status: "conflicted",
          error: "目标内容在 Patch 提议后已发生变化",
          updatedAt: new Date().toISOString()
        });
        throw conflict("目标内容已变化，Patch 未应用", { patchId, status: patch.status });
      }

      const backupFile = await this.writeBackup(patch, currentContent);
      patch = this.repository.update({
        ...patch,
        status: "applying",
        backupFile,
        error: null,
        updatedAt: new Date().toISOString()
      });

      try {
        await this.writeTarget(patch.bookId, patch.target, patch.proposedContent);
        const appliedAt = new Date().toISOString();
        return this.repository.update({
          ...patch,
          status: "applied",
          updatedAt: appliedAt,
          appliedAt
        });
      } catch (error) {
        // 写入失败：对账恢复（目标未被改动则回到 proposed），避免状态卡在 applying
        await this.reconcileApplyingPatch(patch, error);
        throw error;
      }
    });
  }

  /** 拒绝 Patch（proposed → rejected），拒绝原因写入 error 字段。 */
  reject(patchId: string, body: unknown) {
    const input = statePatchRejectInputSchema.parse(body);
    return this.enqueueMutation(async () => {
      const patch = this.repository.get(patchId);
      if (patch.status !== "proposed") {
        throw conflict("只有 proposed Patch 可以拒绝", { patchId, status: patch.status });
      }
      const rejectedAt = new Date().toISOString();
      return this.repository.update({
        ...patch,
        status: "rejected",
        error: input.reason,
        updatedAt: rejectedAt,
        rejectedAt
      });
    });
  }

  /** 启动时恢复：把所有卡在 applying 的 Patch 做一次对账，防止崩溃遗留半更新状态。 */
  async recoverIncompleteApplications() {
    for (const patch of this.repository.listByStatus("applying")) {
      await this.reconcileApplyingPatch(patch);
    }
  }

  /**
   * 对账恢复 applying 状态的 Patch：
   * 目标已是提议内容 → 补记为 applied；目标仍是基线内容 → 回退为 proposed；两者都不是 → conflicted；
   * 任何读取异常 → failed。整个过程不再抛错，只更新状态。
   */
  private async reconcileApplyingPatch(patch: StatePatch, cause?: unknown) {
    try {
      const current = await this.readTarget(patch.bookId, patch.target);
      const currentHash = sha256(current);
      if (currentHash === patch.proposedHash) {
        await this.writeTarget(patch.bookId, patch.target, patch.proposedContent);
        const appliedAt = new Date().toISOString();
        this.repository.update({ ...patch, status: "applied", error: null, updatedAt: appliedAt, appliedAt });
        return;
      }
      if (currentHash === patch.baseHash) {
        this.repository.update({ ...patch, status: "proposed", error: null, updatedAt: new Date().toISOString() });
        return;
      }
      this.repository.update({
        ...patch,
        status: "conflicted",
        error: "恢复 applying Patch 时发现目标内容既不匹配基线，也不匹配提议内容",
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      this.repository.update({
        ...patch,
        status: "failed",
        error: errorMessage(cause ?? error),
        updatedAt: new Date().toISOString()
      });
    }
  }

  /** 读取目标内容：作品文件或章节正文。 */
  private async readTarget(bookId: string, target: StatePatchTarget) {
    if (target.kind === "book_file") {
      return (await getBookFileContent(this.paths, bookId, target.fileId)).content;
    }
    return (await getChapter(this.paths, bookId, target.chapterId)).content;
  }

  /** 写入目标内容（作品文件或章节正文）。 */
  private async writeTarget(bookId: string, target: StatePatchTarget, content: string) {
    if (target.kind === "book_file") {
      await updateBookFileContent(this.paths, bookId, target.fileId, { content });
      return;
    }
    await updateChapter(this.paths, bookId, target.chapterId, { content });
  }

  /** 写应用前备份：备份落在 backups/patches/<book>/<patchId>/ 下，供回滚审计。 */
  private async writeBackup(patch: StatePatch, content: string) {
    const targetName = patch.target.kind === "book_file" ? patch.target.fileId : patch.target.chapterId;
    const relative = path.join("patches", patch.bookId, patch.id, `${targetName}.before.txt`);
    const absolute = resolveInsideRoot(this.paths.backupsDir, relative);
    await ensureDirectory(path.dirname(absolute));
    await writeTextFileAtomic(absolute, content);
    return relative.replace(/\\/g, "/");
  }

  /** 进程内串行队列：后一操作等前一操作结束（失败也不阻塞后续），保证 Patch 写操作的原子性。 */
  private enqueueMutation<T>(operation: () => Promise<T>) {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

/** 统一错误消息提取。 */
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
