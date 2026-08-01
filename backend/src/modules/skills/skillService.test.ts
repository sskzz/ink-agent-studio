import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultAppConfig } from "../../config/defaultAppConfig.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { SkillRepository } from "./skillRepository.js";
import { SkillService } from "./skillService.js";

let root: string | null = null;

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

async function fixture() {
  root = await mkdtemp(path.join(os.tmpdir(), "ink-agent-skills-"));
  const paths = createWorkspacePaths(root);
  await ensureWorkspace(paths);
  const repository = new SkillRepository(paths);
  return { paths, repository, service: new SkillService(repository) };
}

function enabledConfig() {
  return {
    ...defaultAppConfig,
    features: { ...defaultAppConfig.features, skills: true },
    skills: { ...defaultAppConfig.skills, maxLoadedSkills: 2, promptTokenBudget: 80 }
  };
}

describe("SkillService", () => {
  it("installs builtin skills idempotently and validates their instruction hashes", async () => {
    const { paths, repository } = await fixture();
    const first = await repository.list();
    const second = await repository.list();
    expect(first.length).toBe(6);
    expect(second.map((item) => item.id)).toEqual(first.map((item) => item.id));
    await expect(repository.get("continuation-writing")).resolves.toMatchObject({
      metadata: { source: "builtin", instructionHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      instructions: expect.stringContaining("已有正文")
    });
    await repository.setEnabled("continuation-writing", false);
    await writeFile(path.join(paths.skillsDir, "builtin", "continuation-writing", "SKILL.md"), "tampered", "utf8");
    const repaired = await repository.list();
    expect(repaired.find((item) => item.id === "continuation-writing")?.enabled).toBe(false);
    await expect(repository.get("continuation-writing")).resolves.toMatchObject({
      instructions: expect.stringContaining("已有正文")
    });
  });

  it("selects explicit and triggered skills while enforcing count and token budgets", async () => {
    const { service } = await fixture();
    const selection = await service.select({
      operation: "writing",
      instruction: "请继续续写并去 AI 味，保持风格自然",
      context: "当前章节场景",
      requestedSkillIds: []
    }, enabledConfig());
    expect(selection.trace.selected.length).toBeLessThanOrEqual(2);
    expect(selection.trace.totalEstimatedTokens).toBeLessThanOrEqual(80);
    expect(selection.prompt).toContain("章节续写");
    expect(selection.trace.selected.map((item) => item.id)).toEqual(expect.arrayContaining(["continuation-writing"]));
  });

  it("does not load skills when the feature is disabled and requires approval for custom skills", async () => {
    const { service } = await fixture();
    const disabled = await service.select({ operation: "review", instruction: "连续性审查", context: "", requestedSkillIds: [] }, {
      ...defaultAppConfig,
      features: { ...defaultAppConfig.features, skills: false }
    });
    expect(disabled.prompt).toBe("");
    expect(disabled.trace.degradedReasons).toContain("技能系统未启用。");

    await expect(service.create({
      approved: false,
      id: "custom-check",
      name: "自定义检查",
      description: "检查",
      appliesTo: ["review"],
      triggerTerms: ["检查"],
      priority: 50,
      instructions: "只读检查，不写文件。"
    }, defaultAppConfig)).rejects.toThrow("需要明确审批");

    await expect(service.create({
      approved: true,
      id: "custom-check",
      name: "自定义检查",
      description: "检查",
      appliesTo: ["review"],
      triggerTerms: ["检查"],
      priority: 50,
      instructions: "只读检查，不写文件。"
    }, defaultAppConfig)).resolves.toMatchObject({ metadata: { source: "custom" } });
    await expect(service.get("custom-check")).resolves.toMatchObject({
      metadata: { instructionHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
      instructions: "只读检查，不写文件。"
    });
  });
});
