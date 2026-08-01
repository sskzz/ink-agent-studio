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
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly paths: WorkspacePaths,
    private readonly repository: PatchRepository,
    private readonly runEventStore: RunEventStore,
    private readonly configService?: Pick<ConfigService, "get">
  ) {}

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

  get(patchId: string) {
    return this.repository.get(patchId);
  }

  listByBook(bookId: string) {
    return this.repository.listByBook(bookId);
  }

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
      if (input.expectedBaseHash !== patch.baseHash) {
        throw conflict("审批基线哈希与 Patch 不一致", { patchId });
      }

      const currentContent = await this.readTarget(patch.bookId, patch.target);
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
        await this.reconcileApplyingPatch(patch, error);
        throw error;
      }
    });
  }

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

  async recoverIncompleteApplications() {
    for (const patch of this.repository.listByStatus("applying")) {
      await this.reconcileApplyingPatch(patch);
    }
  }

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

  private async readTarget(bookId: string, target: StatePatchTarget) {
    if (target.kind === "book_file") {
      return (await getBookFileContent(this.paths, bookId, target.fileId)).content;
    }
    return (await getChapter(this.paths, bookId, target.chapterId)).content;
  }

  private async writeTarget(bookId: string, target: StatePatchTarget, content: string) {
    if (target.kind === "book_file") {
      await updateBookFileContent(this.paths, bookId, target.fileId, { content });
      return;
    }
    await updateChapter(this.paths, bookId, target.chapterId, { content });
  }

  private async writeBackup(patch: StatePatch, content: string) {
    const targetName = patch.target.kind === "book_file" ? patch.target.fileId : patch.target.chapterId;
    const relative = path.join("patches", patch.bookId, patch.id, `${targetName}.before.txt`);
    const absolute = resolveInsideRoot(this.paths.backupsDir, relative);
    await ensureDirectory(path.dirname(absolute));
    await writeTextFileAtomic(absolute, content);
    return relative.replace(/\\/g, "/");
  }

  private enqueueMutation<T>(operation: () => Promise<T>) {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
