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
import type { TextEmbeddingProvider } from "./localEmbeddingService.js";

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

  it("同名章节在不同作品之间严格隔离", async () => {
    const { database, repository } = await createRepository();
    try {
      repository.upsert({ bookId: "book-a", chapterId: "chapter-0001", chapterNo: 1, chapterRevision: 2, contentHash: "hash-a", summary: "甲书摘要", entities: ["shared-role"], createdAt: "2026-01-01T00:00:00.000Z" });
      repository.upsert({ bookId: "book-b", chapterId: "chapter-0001", chapterNo: 1, chapterRevision: 3, contentHash: "hash-b", summary: "乙书摘要", entities: ["shared-role"], createdAt: "2026-01-02T00:00:00.000Z" });

      expect(repository.findRelated("book-a", ["shared-role"], 5).map((item) => item.summary)).toEqual(["甲书摘要"]);
      expect(repository.findRelated("book-b", ["shared-role"], 5).map((item) => item.summary)).toEqual(["乙书摘要"]);

      repository.removeFrom("book-a", 1);
      expect(repository.listRecent("book-a", 5)).toHaveLength(0);
      expect(repository.listRecent("book-b", 5)).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("三层记忆以 BM25、实体与时间衰减融合排序，Raw 不作为默认注入文本", async () => {
    const { database, repository } = await createRepository();
    try {
      repository.upsert({
        bookId: "book-a", chapterId: "chapter-0001", chapterNo: 1, summary: "进入旧塔",
        rawText: "很长的原始正文证据", synthesizedText: "林夕在月潮时看见旧塔入口显现", entities: ["hero-lin", "old-tower"], createdAt: "2026-01-01T00:00:00.000Z"
      });
      repository.upsert({
        bookId: "book-a", chapterId: "chapter-0020", chapterNo: 20, summary: "港区闲谈",
        rawText: "港口原始正文", synthesizedText: "林夕向船工询问潮汐", entities: ["hero-lin"], createdAt: "2026-01-20T00:00:00.000Z"
      });

      const result = await repository.search({ bookId: "book-a", entities: ["old-tower"], query: "旧塔入口 月潮", currentChapterNo: 21, limit: 2 });

      expect(result[0].chapterId).toBe("chapter-0001");
      expect(result[0].matchReasons).toEqual(expect.arrayContaining(["entity", "bm25"]));
      expect(result[0].synthesizedText).toContain("旧塔入口");
      expect(result[0].rawText).toContain("原始正文证据");
    } finally {
      database.close();
    }
  });

  it("以 RRF 融合本地向量召回，并在无关键词命中时找到语义相关旧记忆", async () => {
    const { database } = await createRepository();
    const provider: TextEmbeddingProvider = {
      modelId: "fake-bge-small-zh",
      dimensions: 2,
      async embedDocuments(texts) {
        return texts.map((text) => text.includes("银钥") ? [1, 0] : [0, 1]);
      },
      async embedQuery() {
        return [1, 0];
      }
    };
    const repository = new ChapterMemoryRepository(database, provider, 200);
    try {
      await repository.upsertWithEmbedding({
        bookId: "book-a", chapterId: "chapter-0002", chapterNo: 2,
        summary: "遗失的银钥", synthesizedText: "林夕把银钥藏入北塔暗格", entities: ["hero-lin"], createdAt: "2026-01-02T00:00:00.000Z"
      });
      await repository.upsertWithEmbedding({
        bookId: "book-a", chapterId: "chapter-0020", chapterNo: 20,
        summary: "港口补给", synthesizedText: "众人在码头购买绳索", entities: [], createdAt: "2026-01-20T00:00:00.000Z"
      });

      const result = await repository.search({
        bookId: "book-a", entities: [], query: "能开启古代机关的物件", currentChapterNo: 21, limit: 2
      });

      expect(result[0].chapterId).toBe("chapter-0002");
      expect(result[0].matchReasons).toContain("vector");
    } finally {
      database.close();
    }
  });

  it("1000 章向量扫描仍能召回第 1 章长期记忆", async () => {
    const { database } = await createRepository();
    const provider: TextEmbeddingProvider = {
      modelId: "fake-scale-embedding",
      dimensions: 2,
      async embedDocuments(texts) {
        return texts.map((text) => text.includes("起源钥匙") ? [1, 0] : [0, 1]);
      },
      async embedQuery() {
        return [1, 0];
      }
    };
    const repository = new ChapterMemoryRepository(database, provider, 1_000);
    try {
      for (let chapterNo = 1; chapterNo <= 1_000; chapterNo += 1) {
        await repository.upsertWithEmbedding({
          bookId: "book-scale",
          chapterId: `chapter-${String(chapterNo).padStart(4, "0")}`,
          chapterNo,
          summary: chapterNo === 1 ? "起源钥匙被藏入旧塔" : `第 ${chapterNo} 章日常推进`,
          synthesizedText: chapterNo === 1 ? "林夕把起源钥匙藏入旧塔暗格" : `众人在第 ${chapterNo} 章继续赶路`,
          entities: [],
          createdAt: new Date(chapterNo * 1_000).toISOString()
        });
      }

      const startedAt = performance.now();
      const result = await repository.search({
        bookId: "book-scale",
        entities: [],
        query: "能打开终局机关的古老物件",
        currentChapterNo: 1_001,
        limit: 5
      });
      const elapsedMs = performance.now() - startedAt;

      expect(result[0].chapterId).toBe("chapter-0001");
      expect(result[0].matchReasons).toContain("vector");
      expect(elapsedMs).toBeLessThan(2_000);
    } finally {
      database.close();
    }
  }, 15_000);
});
