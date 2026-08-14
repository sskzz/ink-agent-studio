import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { createBook } from "./bookService.js";
import { createBookPaths } from "./bookPaths.js";
import { saveEntity } from "./entityService.js";
import { pathExists, readTextFile, writeTextFileAtomic } from "../../utils/fileStore.js";
import { readStoryPlan, readWorldRuleRegistry } from "./storyKnowledgeRepository.js";
import {
  applyLegacyKnowledgeBackfill,
  previewLegacyKnowledgeBackfillApply,
  proposeLegacyKnowledgeBackfill,
  reviewLegacyKnowledgeBackfillItem
} from "./legacyKnowledgeBackfillService.js";
import { bookEntitiesIndexSchema } from "../../schemas/entitySchemas.js";
import { readJsonFile, writeJsonFile } from "../../utils/jsonStore.js";

let root: string | null = null;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ink-agent-legacy-backfill-"));
  await ensureWorkspace(createWorkspacePaths(root));
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = null;
});

describe("legacy knowledge backfill", () => {
  it("预览只生成提案，显式应用后仅创建缺失知识", async () => {
    const paths = createWorkspacePaths(root!);
    const book = await createBook(paths, { title: "旧作品", plannedWords: 100_000, chapterWords: 2_000 });
    const bookPaths = createBookPaths(paths, book.id);
    await writeTextFileAtomic(bookPaths.briefFile, "# 故事基石\n\n林夕寻找失踪姐姐并揭开王城秘密。");
    await writeTextFileAtomic(bookPaths.outlineFile, "# 卷纲规划\n\n## 第 1 卷 进入王城\n## 第 2 卷 地牢真相");
    await writeTextFileAtomic(bookPaths.worldFile, "# 世界观\n\n- 死亡不可逆。\n- 月钥只能在月潮时开启遗迹。");
    await saveEntity(paths, book.id, {
      id: "hero-lin",
      entityType: "character",
      name: "林夕",
      role: "主角",
      description: "谨慎的调查者",
      attributes: { appearance: "黑发", motivation: "寻找姐姐" }
    });
    // 模拟升级前的旧实体索引：旧版本没有 profile，由回填提案补五层档案。
    const legacyEntities = await readJsonFile(bookPaths.entitiesIndexFile, bookEntitiesIndexSchema, []);
    legacyEntities[0].attributes = { appearance: "黑发", motivation: "寻找姐姐" };
    await writeJsonFile(bookPaths.entitiesIndexFile, legacyEntities);

    const proposal = await proposeLegacyKnowledgeBackfill(paths, book.id);

    expect(proposal.status).toBe("proposed");
    expect(proposal.storyPlan).toMatchObject({ plannedChapterCount: 50 });
    expect(proposal.worldRules?.rules).toHaveLength(2);
    expect(proposal.characterProfiles[0].profile.core.appearance).toBe("黑发");
    expect(proposal.decisions.every((item) => item.status === "pending")).toBe(true);
    await expect(readStoryPlan(paths, book.id)).resolves.toBeNull();
    await expect(readWorldRuleRegistry(paths, book.id)).resolves.toBeNull();
    expect(await readTextFile(bookPaths.outlineFile)).toContain("第 1 卷");

    await expect(applyLegacyKnowledgeBackfill(paths, book.id, proposal.id)).rejects.toThrow("仍有待审核项");
    for (const decision of proposal.decisions) {
      await reviewLegacyKnowledgeBackfillItem(paths, book.id, proposal.id, decision.itemKey, { status: "accepted" });
    }
    const preview = await previewLegacyKnowledgeBackfillApply(paths, book.id, proposal.id);
    expect(preview).toMatchObject({ ready: true, counts: { pending: 0, willCreate: 4 } });

    const applied = await applyLegacyKnowledgeBackfill(paths, book.id, proposal.id);

    expect(applied.applied).toEqual({ storyPlan: true, worldRules: true, worldRuleCount: 2, characterProfiles: 1 });
    expect(await pathExists(applied.snapshotPath)).toBe(true);
    await expect(readStoryPlan(paths, book.id)).resolves.toMatchObject({ plannedChapterCount: 50 });
    await expect(readWorldRuleRegistry(paths, book.id)).resolves.toMatchObject({ rules: expect.any(Array) });
  });

  it("应用时保留预览后新增的权威知识，不覆盖现有数据", async () => {
    const paths = createWorkspacePaths(root!);
    const book = await createBook(paths, { title: "保留现有知识" });
    const first = await proposeLegacyKnowledgeBackfill(paths, book.id);
    const manualPlan = structuredClone(first.storyPlan!);
    manualPlan.mainLine = "用户在预览后手动创建的主线";
    const { writeStoryPlan } = await import("./storyKnowledgeRepository.js");
    await writeStoryPlan(paths, book.id, manualPlan);

    for (const decision of first.decisions) {
      await reviewLegacyKnowledgeBackfillItem(paths, book.id, first.id, decision.itemKey, {
        status: decision.itemKey === "story-plan" ? "accepted" : "rejected"
      });
    }
    const applied = await applyLegacyKnowledgeBackfill(paths, book.id, first.id);

    expect(applied.applied.storyPlan).toBe(false);
    await expect(readStoryPlan(paths, book.id)).resolves.toMatchObject({ mainLine: "用户在预览后手动创建的主线" });
  });

  it("支持逐项编辑与拒绝，只应用已接受的合法编辑值", async () => {
    const paths = createWorkspacePaths(root!);
    const book = await createBook(paths, { title: "逐项审核" });
    const proposal = await proposeLegacyKnowledgeBackfill(paths, book.id);
    const editedPlan = structuredClone(proposal.storyPlan!);
    editedPlan.mainLine = "人工审核后确认的主线";

    await reviewLegacyKnowledgeBackfillItem(paths, book.id, proposal.id, "story-plan", {
      status: "accepted",
      editedValue: editedPlan,
      reason: "已核对旧稿"
    });
    for (const decision of proposal.decisions.filter((item) => item.itemKey !== "story-plan")) {
      await reviewLegacyKnowledgeBackfillItem(paths, book.id, proposal.id, decision.itemKey, { status: "rejected", reason: "信息不足" });
    }

    const applied = await applyLegacyKnowledgeBackfill(paths, book.id, proposal.id);
    expect(applied.applied).toMatchObject({ storyPlan: true, worldRules: false, characterProfiles: 0 });
    await expect(readStoryPlan(paths, book.id)).resolves.toMatchObject({ mainLine: "人工审核后确认的主线" });
  });

  it("旧人物描述超长时确定性裁剪，不让单条脏数据阻断整本回填", async () => {
    const paths = createWorkspacePaths(root!);
    const book = await createBook(paths, { title: "超长旧档案" });
    await saveEntity(paths, book.id, {
      id: "hero-long", entityType: "character", name: "长档案角色", role: "主角",
      description: "旧描述".repeat(400), attributes: { motivation: "寻找真相".repeat(200) }
    });
    const bookPaths = createBookPaths(paths, book.id);
    const legacyEntities = await readJsonFile(bookPaths.entitiesIndexFile, bookEntitiesIndexSchema, []);
    legacyEntities[0].attributes = { motivation: "寻找真相".repeat(200) };
    await writeJsonFile(bookPaths.entitiesIndexFile, legacyEntities);

    const proposal = await proposeLegacyKnowledgeBackfill(paths, book.id);
    expect(proposal.characterProfiles[0].profile.arc.startState.length).toBeLessThanOrEqual(300);
    expect(proposal.characterProfiles[0].profile.core.motivations[0].length).toBeLessThanOrEqual(240);
  });
});
