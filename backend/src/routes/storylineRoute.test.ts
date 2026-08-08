// 故事线路由测试：主体/阶段进度、当前位置、短期伏笔与角色状态。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { ensureWorkspace } from "../modules/workspace/workspaceService.js";
import { createApplicationServices, type ApplicationServices } from "../runtime/applicationServices.js";
import { writeRuntimeState } from "../modules/books/runtimeStateRepository.js";
import { createBook } from "../modules/books/bookService.js";
import { createChapter } from "../modules/books/chapterService.js";
import type { RuntimeState } from "../schemas/runtimeStateSchemas.js";

let tempRoot: string | null = null;
let services: ApplicationServices | null = null;

afterEach(async () => {
  if (services) {
    await services.runCoordinator.shutdown(100);
    services.runtimeDatabase.close();
    services = null;
  }
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function createFixture() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-storyline-route-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  services = createApplicationServices(paths);
  const config = await services.configService.initialize();
  await services.runtimeDatabase.initialize({
    busyTimeoutMs: config.storage.sqliteBusyTimeoutMs,
    backupBeforeMigration: false
  });
  const app = createApp(services);
  // 注意：章节路由读取默认工作区，测试必须用模块级函数写入临时目录（与 books 路由一致用 services.paths）
  const book = await createBook(services.paths, { title: "故事线测试" });
  const chapter = await createChapter(services.paths, book.id, { title: "第一章", content: "开局。" });

  const runtime: RuntimeState = {
    schemaVersion: "book-runtime-state.v1",
    baseline: {
      storyStart: "苏见看见系统面板",
      publicFacts: [],
      secrets: [],
      nextGoals: ["接近陈栀"],
      characterStates: [{ characterId: "su-jian", state: "刚觉醒观测能力" }],
      factionStates: [],
      itemStates: [],
      foreshadowing: [
        { id: "hook-a", content: "陈栀的隐藏注记", relatedEntityIds: [], placement: "第一卷", resolution: "第二卷", status: "planned", lastAdvancedChapter: null },
        { id: "hook-b", content: "已回收伏笔", relatedEntityIds: [], placement: "第一卷", resolution: "第一卷", status: "resolved", lastAdvancedChapter: 1 }
      ]
    },
    deltas: [],
    history: [],
    state: {
      storyStart: "苏见看见系统面板",
      publicFacts: [],
      secrets: [],
      nextGoals: ["接近陈栀"],
      characterStates: [{ characterId: "su-jian", state: "刚觉醒观测能力" }],
      factionStates: [],
      itemStates: [],
      foreshadowing: [
        { id: "hook-a", content: "陈栀的隐藏注记", relatedEntityIds: [], placement: "第一卷", resolution: "第二卷", status: "planted", lastAdvancedChapter: 1 },
        { id: "hook-b", content: "已回收伏笔", relatedEntityIds: [], placement: "第一卷", resolution: "第一卷", status: "resolved", lastAdvancedChapter: 1 }
      ]
    },
    chapterSummaries: { [chapter.id]: "第一章推进：苏见确认面板异常" }
  };
  await writeRuntimeState(services.paths, book.id, runtime);

  return { app, bookId: book.id, chapterId: chapter.id, chapterNo: chapter.chapterNo };
}

describe("storyline route", () => {
  it("returns main/stage progress, position, active foreshadowing and character states", async () => {
    const { app, bookId } = await createFixture();
    const response = await app.request(`/api/v1/books/${bookId}/storyline`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: Record<string, unknown> };

    console.log("MAINPROGRESS:", JSON.stringify(payload.data.mainProgress));
    expect(payload.data.mainProgress).toContain("起点：苏见看见系统面板");
    expect(payload.data.mainProgress).toContain("下一阶段目标：接近陈栀");
    expect((payload.data.mainProgress as string[]).some((item) => item.includes("第一章推进"))).toBe(true);

    const stage = payload.data.stageProgress as { volume: number; chapterNo: number; chapterTotal: number };
    expect(stage.chapterNo).toBe(1);
    expect(stage.chapterTotal).toBe(1);
    expect(stage.volume).toBe(1);

    const position = payload.data.currentPosition as { main: string; stage: string };
    expect(position.main).toContain("第 1 章");
    expect(position.stage).toContain("第 1 卷");

    // 短期伏笔只含未回收条目，已回收的 hook-b 排除
    const foreshadowing = payload.data.shortForeshadowing as Array<{ id: string; status: string }>;
    expect(foreshadowing.map((item) => item.id)).toEqual(["hook-a"]);
    expect(foreshadowing[0].status).toBe("planted");

    const characters = payload.data.characterStates as Array<{ characterId: string; state: string }>;
    expect(characters[0]).toMatchObject({ characterId: "su-jian", state: "刚觉醒观测能力" });
  });

  it("returns 404 for a missing book", async () => {
    const { app } = await createFixture();
    const response = await app.request("/api/v1/books/missing-book/storyline");
    expect(response.status).toBe(404);
  });
});
