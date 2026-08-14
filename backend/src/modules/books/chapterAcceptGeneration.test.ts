import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChapterGenerationMode, RunCommand } from "@ink-agent/contracts";
import { sha256 } from "../../utils/hash.js";
import { createApplicationServices, type ApplicationServices } from "../../runtime/applicationServices.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { createBook } from "./bookService.js";
import { acceptChapterGeneration, createChapter, getChapter, updateChapter } from "./chapterService.js";
import type { RunCoordinator } from "../agents/runCoordinator.js";
import { createBaselineRuntimeState, writeRuntimeState } from "./runtimeStateRepository.js";
import { createInitialWorldRuleRegistry, writeWorldRuleRegistry } from "./storyKnowledgeRepository.js";

let tempRoot: string | null = null;
let services: ApplicationServices | null = null;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-accept-generation-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  services = createApplicationServices(paths);
  await services.configService.initialize();
  const config = await services.configService.get();
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

describe("acceptChapterGeneration", () => {
  it.each([
    ["continue", "append", "原正文\n\n新尾部"],
    ["generate", "replace", "完整新正文"],
    ["regenerate", "replace", "完整新正文"]
  ] as const)("%s 模式按 %s 策略保存并启动观察 Run", async (generationMode, writeStrategy, expectedContent) => {
    const fixture = await createFixture();
    const sourceRunId = createCompletedGenerationRun(fixture.bookId, fixture.chapterId, {
      generationMode,
      writeStrategy,
      draft: generationMode === "continue" ? "新尾部" : "完整新正文",
      outline: fixture.outline
    });
    const enqueued: RunCommand[] = [];
    const coordinator = {
      enqueueSystem: async (command: RunCommand) => {
        enqueued.push(command);
        return { id: "observe-run", updatedAt: new Date(0).toISOString() };
      }
    } as unknown as RunCoordinator;

    const result = await acceptChapterGeneration(
      services!.paths,
      services!.runEventStore,
      coordinator,
      fixture.bookId,
      fixture.chapterId,
      { runId: sourceRunId }
    );

    expect((await getChapter(services!.paths, fixture.bookId, fixture.chapterId)).content).toBe(expectedContent);
    expect(result.observation.runId).toBe("observe-run");
    expect(enqueued[0]).toMatchObject({
      type: "observe_chapter",
      bookId: fixture.bookId,
      chapterId: fixture.chapterId,
      input: { sourceRunId }
    });
  });

  it("章节细纲在生成后发生变化时拒绝采纳", async () => {
    const fixture = await createFixture();
    const sourceRunId = createCompletedGenerationRun(fixture.bookId, fixture.chapterId, {
      generationMode: "regenerate",
      writeStrategy: "replace",
      draft: "完整新正文",
      outline: fixture.outline
    });
    await updateChapter(services!.paths, fixture.bookId, fixture.chapterId, { outline: "用户修改后的细纲" });

    await expect(acceptChapterGeneration(
      services!.paths,
      services!.runEventStore,
      {} as RunCoordinator,
      fixture.bookId,
      fixture.chapterId,
      { runId: sourceRunId }
    )).rejects.toThrow("章节细纲已缺失或发生变化");
  });

  it("生成结果未通过知识质量门时拒绝采纳", async () => {
    const fixture = await createFixture();
    const sourceRunId = createCompletedGenerationRun(fixture.bookId, fixture.chapterId, {
      generationMode: "regenerate",
      writeStrategy: "replace",
      draft: "冲突正文",
      outline: fixture.outline,
      knowledgePassed: false
    });

    await expect(acceptChapterGeneration(
      services!.paths,
      services!.runEventStore,
      {} as RunCoordinator,
      fixture.bookId,
      fixture.chapterId,
      { runId: sourceRunId }
    )).rejects.toThrow("未通过知识一致性质量门");
  });

  it("采纳前按最新世界规则重新审核", async () => {
    const fixture = await createFixture();
    const sourceRunId = createCompletedGenerationRun(fixture.bookId, fixture.chapterId, {
      generationMode: "regenerate",
      writeStrategy: "replace",
      draft: "主角成功复活死者。",
      outline: fixture.outline
    });
    const registry = createInitialWorldRuleRegistry(fixture.bookId, [{
      id: "rule-death",
      title: "死亡不可逆",
      content: "死亡不可逆。",
      category: "law",
      mutability: "immutable"
    }]);
    registry.rules[0].prohibitedExpressions = ["成功复活死者"];
    await writeWorldRuleRegistry(services!.paths, fixture.bookId, registry);

    await expect(acceptChapterGeneration(
      services!.paths,
      services!.runEventStore,
      {} as RunCoordinator,
      fixture.bookId,
      fixture.chapterId,
      { runId: sourceRunId }
    )).rejects.toThrow("不满足最新约束");
  });
});

async function createFixture() {
  const book = await createBook(services!.paths, { title: "采纳测试" });
  await writeRuntimeState(services!.paths, book.id, createBaselineRuntimeState({
    storyStart: "故事开始",
    publicFacts: [],
    secrets: [],
    nextGoals: [],
    characterStates: [],
    factionStates: [],
    itemStates: [],
    foreshadowing: []
  }));
  const outline = "主角发现线索，在冲突中作出选择，并以新悬念收束。";
  const chapter = await createChapter(services!.paths, book.id, {
    title: "第一章",
    outline,
    content: "原正文"
  });
  return { bookId: book.id, chapterId: chapter.id, outline };
}

function createCompletedGenerationRun(
  bookId: string,
  chapterId: string,
  input: { generationMode: ChapterGenerationMode; writeStrategy: "append" | "replace"; draft: string; outline: string; knowledgePassed?: boolean }
) {
  const command: RunCommand = {
    schemaVersion: "run-command.v1",
    type: "continue_chapter",
    bookId,
    chapterId,
    input: {
      instruction: "",
      selectedContextFileIds: [],
      sceneType: "auto",
      allowDegradedStyle: false,
      generationMode: input.generationMode
    }
  };
  const run = services!.runEventStore.createRun({ command, configRevision: 1, configHash: "test-config" });
  services!.runEventStore.appendEvent(run.id, { type: "run_started", payload: {} });
  services!.runEventStore.appendEvent(run.id, {
    type: "run_completed",
    payload: {
      output: {
        output: {
          chapterId,
          draft: input.draft,
          chapterOutline: input.outline,
          outlineHash: sha256(input.outline),
          outlineSource: "existing",
          generationMode: input.generationMode,
          writeStrategy: input.writeStrategy,
          knowledgeAudit: {
            initial: {
              schemaVersion: "chapter-knowledge-audit.v1",
              passed: input.knowledgePassed ?? true,
              blockingIssues: input.knowledgePassed === false ? [{ code: "LOCKED_TERM_ALIAS", sourceId: "term-test", message: "测试冲突" }] : [],
              warnings: []
            },
            final: {
              schemaVersion: "chapter-knowledge-audit.v1",
              passed: input.knowledgePassed ?? true,
              blockingIssues: input.knowledgePassed === false ? [{ code: "LOCKED_TERM_ALIAS", sourceId: "term-test", message: "测试冲突" }] : [],
              warnings: []
            },
            revisionCount: 0
          }
        }
      }
    }
  });
  return run.id;
}
