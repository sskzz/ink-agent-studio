// 测试：会话与消息的增查、搜索与归档。
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAppConfig } from "../../config/defaultAppConfig.js";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { RunEventStore } from "../agents/runEventStore.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { SessionRepository } from "./sessionRepository.js";
import { SessionService } from "./sessionService.js";

let tempRoot: string | null = null;
let runtimeDatabase: RuntimeDatabase | null = null;

afterEach(async () => {
  runtimeDatabase?.close();
  runtimeDatabase = null;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function setup() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-sessions-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  runtimeDatabase = new RuntimeDatabase(paths);
  await runtimeDatabase.initialize({ busyTimeoutMs: 1_000, backupBeforeMigration: false });
  const repository = new SessionRepository(runtimeDatabase);
  const service = new SessionService(repository, { async get() { return structuredClone(defaultAppConfig); } });
  return { repository, service, runStore: new RunEventStore(runtimeDatabase), database: runtimeDatabase };
}

describe("SessionService", () => {
  it("stores messages and searches Chinese content with FTS and short-query fallback", async () => {
    const { service } = await setup();
    const session = service.create({ bookId: "book-1", title: "", parentSessionId: null });
    const user = service.addMessage(session.id, {
      role: "user",
      content: "主角在旧仓库发现一枚青铜钥匙，钥匙上刻着潮汐纹。",
      parentMessageId: null,
      metadata: { source: "editor" }
    });
    service.addMessage(session.id, {
      role: "assistant",
      content: "建议让青铜钥匙与北塔密室产生关联。",
      parentMessageId: user.id,
      metadata: {}
    });

    expect(service.get(session.id).title).toContain("主角在旧仓库");
    await expect(service.listMessages(session.id)).resolves.toHaveLength(2);
    const fts = await service.search({ query: "青铜钥匙", sessionId: session.id, limit: 10 });
    expect(fts).toHaveLength(2);
    expect(fts[0].snippet).toContain("青铜钥匙");
    const fallback = await service.search({ query: "北塔", bookId: "book-1", limit: 10 });
    expect(fallback).toHaveLength(1);
  });

  it("enforces message ancestry and blocks writes after archive", async () => {
    const { service } = await setup();
    const first = service.create({ bookId: null, title: "第一会话", parentSessionId: null });
    const second = service.create({ bookId: null, title: "第二会话", parentSessionId: null });
    const firstMessage = service.addMessage(first.id, { role: "user", content: "第一条", metadata: {} });

    expect(() => service.addMessage(second.id, {
      role: "assistant",
      content: "错误父链",
      parentMessageId: firstMessage.id,
      metadata: {}
    })).toThrow("父消息不属于当前 Session");
    service.archive(first.id);
    expect(() => service.addMessage(first.id, { role: "user", content: "归档后写入", metadata: {} }))
      .toThrow("已归档 Session 不能追加消息");
  });

  it("links a run to its session and trigger message", async () => {
    const { service, runStore, database } = await setup();
    const session = service.create({ bookId: "book-1", title: "运行会话", parentSessionId: null });
    const message = service.addMessage(session.id, { role: "user", content: "继续这一章", metadata: {} });
    const run = runStore.createRun({
      command: {
        schemaVersion: "run-command.v1",
        type: "continue_chapter",
        bookId: "book-1",
        chapterId: "chapter-1",
        input: { instruction: "继续", selectedContextFileIds: [], sceneType: "auto", allowDegradedStyle: false }
      },
      sessionId: session.id,
      triggerMessageId: message.id,
      configRevision: 1,
      configHash: "config"
    });

    expect(run).toMatchObject({ sessionId: session.id, triggerMessageId: message.id });
    const link = database.database.prepare("SELECT * FROM session_runs WHERE run_id = ?").get(run.id);
    expect(link).toMatchObject({ session_id: session.id, trigger_message_id: message.id });
  });
});
