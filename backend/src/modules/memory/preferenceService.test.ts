import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppConfig } from "@ink-agent/contracts";
import { defaultAppConfig } from "../../config/defaultAppConfig.js";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { SessionRepository } from "../sessions/sessionRepository.js";
import { estimateTokens } from "../prompts/promptAssembler.js";
import { PreferenceRepository } from "./preferenceRepository.js";
import { PreferenceService } from "./preferenceService.js";
import { userMemoryPromptSourceLabel } from "./memoryPromptPolicy.js";
import { PromptAssembler } from "../prompts/promptAssembler.js";

let tempRoot: string | null = null;
let runtimeDatabase: RuntimeDatabase | null = null;

afterEach(async () => {
  runtimeDatabase?.close();
  runtimeDatabase = null;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

async function setup() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-memory-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  runtimeDatabase = new RuntimeDatabase(paths);
  await runtimeDatabase.initialize({ busyTimeoutMs: 1_000, backupBeforeMigration: false });
  const repository = new PreferenceRepository(runtimeDatabase);
  const config: AppConfig = structuredClone(defaultAppConfig);
  const service = new PreferenceService(repository, { async get() { return config; } });
  return { config, repository, service, sessions: new SessionRepository(runtimeDatabase), database: runtimeDatabase.database };
}

const proposal = (overrides: Record<string, unknown> = {}) => ({
  category: "writing",
  key: "paragraph_length",
  value: "正文优先使用短段落，动作场景尤其紧凑。",
  reason: "这是长期稳定的阅读偏好。",
  priority: 70,
  sourceSessionId: null,
  sourceMessageId: null,
  ...overrides
});

describe("PreferenceService", () => {
  it("keeps proposals inactive until explicit approval and atomically archives the previous value", async () => {
    const { service, database } = await setup();
    const first = service.propose(proposal());
    expect(first.status).toBe("proposed");
    expect((await service.select()).prompt).toBe("");
    await expect(service.approve(first.id, false)).rejects.toThrow("明确确认");

    const active = await service.approve(first.id, true);
    expect(active.status).toBe("active");
    expect((await service.select()).prompt).toContain("短段落");

    const replacement = service.propose(proposal({ value: "正文优先使用中短段落。", priority: 80 }));
    const next = await service.approve(replacement.id, true);
    expect(next.replacesPreferenceId).toBe(first.id);
    expect(service.get(first.id).status).toBe("archived");
    expect(database.prepare("SELECT COUNT(*) AS count FROM user_preferences WHERE preference_key = ? AND status = 'active'")
      .get("paragraph_length")?.count).toBe(1);
    expect(() => database.prepare(`
      UPDATE user_preferences SET status = 'active', archived_at = NULL WHERE id = ?
    `).run(first.id)).toThrow();
    expect(() => database.prepare(`
      INSERT INTO user_preferences (
        id, schema_version, category, preference_key, value, reason, rejection_reason, status,
        priority, token_estimate, source_session_id, source_message_id, replaces_preference_id,
        created_at, updated_at, approved_at, rejected_at, archived_at
      ) SELECT 'forged-active', schema_version, category, 'dialogue_density', value, reason, NULL, 'active',
        priority, token_estimate, NULL, NULL, NULL, created_at, updated_at, updated_at, NULL, NULL
      FROM user_preferences WHERE id = ?
    `).run(first.id)).toThrow("must be inserted as proposed");
  });

  it("enforces valid rejection/archive transitions without mutating the proposal reason", async () => {
    const { service } = await setup();
    const rejected = service.propose(proposal({ key: "dialogue_density" }));
    const result = service.reject(rejected.id, "该偏好只是本轮临时要求");
    expect(result).toMatchObject({ status: "rejected", reason: rejected.reason, rejectionReason: "该偏好只是本轮临时要求" });
    expect(() => service.reject(rejected.id, "再次拒绝")).not.toThrow();
    await expect(service.approve(rejected.id, true)).rejects.toThrow("只有 proposed");

    const active = await service.approve(service.propose(proposal({ key: "output_format" })).id, true);
    await expect(service.archive(active.id, false)).rejects.toThrow("明确确认");
    expect((await service.archive(active.id, true)).status).toBe("archived");
    await expect(service.archive(rejected.id, true)).rejects.toThrow("只有 active");
  });

  it("validates source ancestry and rejects story facts while allowing workflow preferences", async () => {
    const { service, sessions } = await setup();
    const first = sessions.create({ bookId: "book-1", title: "A", parentSessionId: null });
    const second = sessions.create({ bookId: "book-1", title: "B", parentSessionId: null });
    const message = sessions.addMessage(first.id, { role: "user", content: "以后审稿严格一些", metadata: {} });

    expect(() => service.propose(proposal({ sourceSessionId: null, sourceMessageId: message.id }))).toThrow();
    expect(() => service.propose(proposal({ sourceSessionId: second.id, sourceMessageId: message.id })))
      .toThrow("不属于指定 Session");
    expect(() => runtimeDatabase!.database.prepare(`
      INSERT INTO user_preferences (
        id, schema_version, category, preference_key, value, reason, rejection_reason, status,
        priority, token_estimate, source_session_id, source_message_id, replaces_preference_id,
        created_at, updated_at, approved_at, rejected_at, archived_at
      ) VALUES (?, 'user-preference.v1', 'writing', 'paragraph_length', ?, ?, NULL, 'proposed',
        50, 10, ?, ?, NULL, ?, ?, NULL, NULL, NULL)
    `).run("forged-source", "短段落", "稳定偏好", second.id, message.id, new Date().toISOString(), new Date().toISOString()))
      .toThrow("does not belong");
    expect(service.propose(proposal({
      category: "review",
      key: "review_strictness",
      value: "审稿时严格检查人物一致性。",
      sourceSessionId: first.id,
      sourceMessageId: message.id
    })).status).toBe("proposed");
    expect(() => service.propose(proposal({ value: "主角叫林舟，父亲是城主。" }))).toThrow("疑似作品事实");
    expect(() => service.propose(proposal({ value: "反派名为陆沉，最终获得法宝。" }))).toThrow("疑似作品事实");
    expect(() => service.propose(proposal({ value: "The protagonist is Lin Zhou." }))).toThrow("疑似作品事实");
  });

  it("honors enablement, entry limits and the complete prompt token budget", async () => {
    const { service, config } = await setup();
    for (const [key, priority, value] of [
      ["paragraph_length", 90, "正文尽量使用短段落。"],
      ["dialogue_density", 80, "增加自然对白。"],
      ["description_density", 70, "减少静态环境说明。"]
    ] as const) {
      await service.approve(service.propose(proposal({ key, priority, value })).id, true);
    }
    config.memory.maxActiveEntries = 2;
    config.memory.promptTokenBudget = 128;
    const selected = await service.select();
    expect(selected.trace.activeScanned).toBe(2);
    expect(selected.trace.selectedIds).toHaveLength(2);
    expect(selected.trace.totalEstimatedTokens).toBe(estimateTokens(selected.prompt));
    expect(selected.trace.totalEstimatedTokens).toBeLessThanOrEqual(config.memory.promptTokenBudget);
    const assembled = new PromptAssembler().assemble([
      { name: "stable", budgetTokens: 128, sources: [] },
      { name: "facts", budgetTokens: 128, sources: [] },
      { name: "memory", budgetTokens: config.memory.promptTokenBudget, sources: [{ id: "memory", label: userMemoryPromptSourceLabel, content: selected.prompt, priority: 50 }] },
      { name: "scene", budgetTokens: 128, sources: [] },
      { name: "skills", budgetTokens: 128, sources: [] },
      { name: "turn", budgetTokens: 128, sources: [] }
    ]);
    expect(assembled.trace.layers.find((layer) => layer.name === "memory")?.truncated).toBe(false);

    expect(() => runtimeDatabase!.database.prepare(
      "UPDATE user_preferences SET value = '直接篡改已批准偏好' WHERE id = (SELECT id FROM user_preferences WHERE status = 'active' LIMIT 1)"
    ).run()).toThrow("immutable");

    config.memory.enabled = false;
    expect(await service.select()).toMatchObject({ prompt: "", trace: { enabled: false, selectedIds: [] } });
  });
});
