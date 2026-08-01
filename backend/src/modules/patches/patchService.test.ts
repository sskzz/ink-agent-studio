import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBookStorage, createBookId } from "../books/bookRepository.js";
import type { BookRecord } from "../../types/domain.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { RunEventStore } from "../agents/runEventStore.js";
import { PatchRepository } from "./patchRepository.js";
import { PatchService } from "./patchService.js";
import { createBookPaths } from "../books/bookPaths.js";
import { sha256 } from "../../utils/hash.js";

let tempRoot: string | null = null;
let runtimeDatabase: RuntimeDatabase | null = null;

afterEach(async () => {
  runtimeDatabase?.close();
  runtimeDatabase = null;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function setup() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-patches-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  runtimeDatabase = new RuntimeDatabase(paths);
  await runtimeDatabase.initialize({ busyTimeoutMs: 1_000, backupBeforeMigration: false });
  const runStore = new RunEventStore(runtimeDatabase);
  const bookId = createBookId();
  const book: BookRecord = {
    id: bookId,
    title: "Patch Test",
    genre: "测试",
    status: "drafting",
    narrationPerspective: "第三人称",
    channel: "男频",
    writingStyleId: null,
    writingStyleVersionId: null,
    protagonistGender: "",
    protagonistName: "",
    plannedWords: null,
    chapterWords: null,
    writtenWords: 0,
    writtenChapters: 0,
    currentChapterId: null,
    worldFileId: "world",
    needsAiFill: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await createBookStorage(paths, book);
  const run = runStore.createRun({
    command: {
      schemaVersion: "run-command.v1",
      type: "consistency_check",
      bookId,
      input: { instruction: "", selectedContextFileIds: [], sceneType: "auto", allowDegradedStyle: false }
    },
    configRevision: 1,
    configHash: "test"
  });
  const service = new PatchService(paths, new PatchRepository(runtimeDatabase), runStore);
  return { paths, bookId, runId: run.id, service };
}

describe("PatchService", () => {
  it("proposes without writing, then applies with a backup", async () => {
    const { paths, bookId, runId, service } = await setup();
    const original = await readFile(createBookPaths(paths, bookId).worldFile, "utf8");
    const proposal = await service.propose(runId, {
      bookId,
      target: { kind: "book_file", fileId: "world" },
      proposedContent: `${original}\n## 新规则\n不可逆。\n`,
      reason: "补充世界规则"
    });
    expect(proposal.status).toBe("proposed");
    await expect(readFile(createBookPaths(paths, bookId).worldFile, "utf8")).resolves.toBe(original);

    const applied = await service.apply(proposal.id, { approved: true, expectedBaseHash: proposal.baseHash });
    expect(applied.status).toBe("applied");
    expect(applied.backupFile).toContain(`patches/${bookId}/${proposal.id}`);
    await expect(readFile(createBookPaths(paths, bookId).worldFile, "utf8")).resolves.toContain("不可逆");
    await expect(readFile(path.resolve(paths.backupsDir, applied.backupFile!), "utf8")).resolves.toBe(original);
  });

  it("marks a patch conflicted instead of overwriting a changed target", async () => {
    const { paths, bookId, runId, service } = await setup();
    const original = await readFile(createBookPaths(paths, bookId).worldFile, "utf8");
    const proposal = await service.propose(runId, {
      bookId,
      target: { kind: "book_file", fileId: "world" },
      proposedContent: `${original}\nAI 提案\n`,
      reason: "测试冲突"
    });
    const changed = `${original}\n用户已修改\n`;
    const { updateBookFileContent } = await import("../files/fileService.js");
    await updateBookFileContent(paths, bookId, "world", { content: changed });

    await expect(service.apply(proposal.id, { approved: true, expectedBaseHash: proposal.baseHash }))
      .rejects.toThrow("目标内容已变化");
    expect(service.get(proposal.id).status).toBe("conflicted");
    await expect(readFile(createBookPaths(paths, bookId).worldFile, "utf8")).resolves.toBe(changed);
    expect(sha256(changed)).not.toBe(proposal.proposedHash);
  });
});
