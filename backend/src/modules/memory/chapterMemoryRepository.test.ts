/**
 * 章节记忆仓库单测：upsert / 实体交集检索 / 最近回退 / 删除。
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { ChapterMemoryRepository } from "./chapterMemoryRepository.js";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

/** 打开临时库并初始化（含 v9 chapter_memory 迁移）。 */
async function createRepository() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-chapter-memory-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  const database = new RuntimeDatabase(paths);
  await database.initialize({ busyTimeoutMs: 1_500, backupBeforeMigration: false });
  return { database, repository: new ChapterMemoryRepository(database) };
}

describe("ChapterMemoryRepository", () => {
  it("upsert 写入并可检索（实体交集命中优先）", async () => {
    const { database, repository } = await createRepository();
    try {
      repository.upsert({ chapterId: "chapter-0001", chapterNo: 1, summary: "第一章：苏见觉醒", entities: ["su-jian"], createdAt: "2026-01-01T00:00:00.000Z" });
      repository.upsert({ chapterId: "chapter-0002", chapterNo: 2, summary: "第二章：陈栀的备考压力", entities: ["chen-zhi"], createdAt: "2026-01-02T00:00:00.000Z" });
      repository.upsert({ chapterId: "chapter-0003", chapterNo: 3, summary: "第三章：苏见与陈栀交谈", entities: ["su-jian", "chen-zhi"], createdAt: "2026-01-03T00:00:00.000Z" });

      // 按实体交集检索：命中 su-jian 的章节按章节号倒序
      const related = repository.findRelated(["su-jian"], 5);

      expect(related.map((record) => record.chapterId)).toEqual(["chapter-0003", "chapter-0001"]);
      expect(related[0].summary).toContain("苏见与陈栀");

      // 无实体命中时回退最近 N 条
      const recent = repository.findRelated([], 2);
      expect(recent.map((record) => record.chapterId)).toEqual(["chapter-0003", "chapter-0002"]);
    } finally {
      database.close();
    }
  });

  it("同章重复保存时覆盖", async () => {
    const { database, repository } = await createRepository();
    try {
      repository.upsert({ chapterId: "chapter-0001", chapterNo: 1, summary: "旧摘要", entities: [], createdAt: "2026-01-01T00:00:00.000Z" });
      repository.upsert({ chapterId: "chapter-0001", chapterNo: 1, summary: "新摘要", entities: ["su-jian"], createdAt: "2026-01-02T00:00:00.000Z" });

      const related = repository.findRelated(["su-jian"], 5);

      expect(related).toHaveLength(1);
      expect(related[0].summary).toBe("新摘要");
    } finally {
      database.close();
    }
  });

  it("remove 删除指定章节记忆", async () => {
    const { database, repository } = await createRepository();
    try {
      repository.upsert({ chapterId: "chapter-0001", chapterNo: 1, summary: "第一章", entities: ["su-jian"], createdAt: "2026-01-01T00:00:00.000Z" });
      repository.remove("chapter-0001");

      expect(repository.findRelated([], 5)).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});
