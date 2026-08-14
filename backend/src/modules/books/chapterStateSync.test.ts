import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApplicationServices, type ApplicationServices } from "../../runtime/applicationServices.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { createBook } from "./bookService.js";
import {
  createChapter,
  getChapter,
  markChapterObservationFailed,
  prepareChapterRunInput,
  updateChapter
} from "./chapterService.js";
import { withStoryStateEvents } from "./storyStateEventRepository.js";

let tempRoot: string | null = null;
let services: ApplicationServices | null = null;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-chapter-sync-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  services = createApplicationServices(paths);
  const config = await services.configService.initialize();
  await services.runtimeDatabase.initialize({
    busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
    backupBeforeMigration: false
  });
});

afterEach(async () => {
  if (services) {
    await services.runCoordinator.shutdown(100);
    services.runtimeDatabase.close();
    services = null;
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("chapter state synchronization", () => {
  it("前序正文状态未同步时阻断后续章节生成", async () => {
    const book = await createBook(services!.paths, { title: "同步闸门" });
    const first = await createChapter(services!.paths, book.id, { title: "第一章", content: "第一章有效正文" });
    const second = await createChapter(services!.paths, book.id, { title: "第二章" });

    expect(first.stateSyncStatus).toBe("pending");
    await expect(prepareChapterRunInput(services!.paths, book.id, second.id, {
      instruction: "生成第二章",
      selectedContextFileIds: [],
      sceneType: "auto",
      allowDegradedStyle: false,
      generationMode: "generate"
    })).rejects.toThrow("前序章节状态尚未同步");
  });

  it("过期观察失败不会覆盖新修订，新修订对应失败会落账", async () => {
    const book = await createBook(services!.paths, { title: "失败落账" });
    const chapter = await createChapter(services!.paths, book.id, { title: "第一章", content: "第一版正文" });
    const revised = await updateChapter(services!.paths, book.id, chapter.id, { content: "第二版正文" });
    const config = await services!.configService.get();
    await withStoryStateEvents(services!.paths, config, (events) => events.setObservationRun(book.id, chapter.id, "current-run"));

    await markChapterObservationFailed(
      services!.paths,
      book.id,
      chapter.id,
      new Error("旧任务失败"),
      chapter.revision,
      chapter.contentHash
    );
    expect((await getChapter(services!.paths, book.id, chapter.id)).stateSyncStatus).toBe("pending");

    await markChapterObservationFailed(
      services!.paths,
      book.id,
      chapter.id,
      new Error("被替代的同版本任务失败"),
      revised.revision,
      revised.contentHash,
      "old-run"
    );
    expect((await getChapter(services!.paths, book.id, chapter.id)).stateSyncStatus).toBe("pending");

    await markChapterObservationFailed(
      services!.paths,
      book.id,
      chapter.id,
      new Error("观察模型失败"),
      revised.revision,
      revised.contentHash,
      "current-run"
    );
    const failed = await getChapter(services!.paths, book.id, chapter.id);
    expect(failed.stateSyncStatus).toBe("failed");
    expect(failed.stateSyncError).toContain("观察模型失败");
  });
});
