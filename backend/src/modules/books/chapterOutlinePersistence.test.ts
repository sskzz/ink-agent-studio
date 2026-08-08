/**
 * AI 细纲写回单测：细纲仅在章节 outline 为空时补全（不覆盖手写内容），且为轻量写入。
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBook } from "./bookService.js";
import { backfillChapterOutline, createChapter, getChapter } from "./chapterService.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function createFixture() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-chapter-outline-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  const book = await createBook(paths, { title: "细纲写回测试" });
  const chapter = await createChapter(paths, book.id, { title: "第一章", content: "开场。" });
  expect(chapter.outline).toBe("");
  return { paths, bookId: book.id, chapterId: chapter.id };
}

describe("backfillChapterOutline", () => {
  it("空细纲章节补全 AI 细纲后返回 true 且可重新读到", async () => {
    const { paths, bookId, chapterId } = await createFixture();
    const written = await backfillChapterOutline(paths, bookId, chapterId, "场景 1：…\n推进：…");
    expect(written).toBe(true);
    const updated = await getChapter(paths, bookId, chapterId);
    expect(updated.outline).toBe("场景 1：…\n推进：…");
  });

  it("已有用户细纲的章节保持原样并返回 false", async () => {
    const { paths, bookId, chapterId } = await createFixture();
    await backfillChapterOutline(paths, bookId, chapterId, "用户手写细纲");
    const overwritten = await backfillChapterOutline(paths, bookId, chapterId, "AI 生成的细纲");
    expect(overwritten).toBe(false);
    const updated = await getChapter(paths, bookId, chapterId);
    expect(updated.outline).toBe("用户手写细纲");
  });
});