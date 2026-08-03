/**
 * 技能服务。
 * 职责：技能的增删查改与「技能选择」——按操作类型、触发词、显式请求与优先级打分，在数量与 Token 预算内选出本轮技能并组装 Prompt；
 * 边界：写操作受 writeApprovalRequired 配置约束（须显式审批）；技能只是工作流建议，无权写入文件或覆盖作品事实（由 Prompt 层约束）。
 */
import type {
  AppConfig,
  NovelSkillCreateInput,
  NovelSkillOperation,
  NovelSkillPreviewInput,
  NovelSkillSelection
} from "@ink-agent/contracts";
import { conflict } from "../../utils/errors.js";
import { estimateTokens } from "../prompts/promptAssembler.js";
import { SkillRepository } from "./skillRepository.js";

export class SkillService {
  constructor(private readonly repository: SkillRepository) {}

  /** 列出全部技能（含内置技能的自愈安装）。 */
  list() {
    return this.repository.list();
  }

  /** 按 id 读取技能详情（含指令文本）。 */
  get(id: string) {
    return this.repository.get(id);
  }

  /** 创建自定义技能：必须显式审批（防未确认写入），审批标记不落盘。 */
  async create(input: Omit<NovelSkillCreateInput, "approved"> & { approved: boolean }, config: AppConfig) {
    if (!input.approved) throw conflict("创建自定义技能需要明确审批", { setting: "skills.writeApprovalRequired" });
    const { approved: _approved, ...definition } = input;
    return this.repository.create(definition);
  }

  /** 启停技能：配置要求确认时必须显式审批。 */
  async setEnabled(id: string, enabled: boolean, approved: boolean, config: AppConfig) {
    if (config.skills.writeApprovalRequired && !approved) {
      throw conflict("修改技能启用状态需要明确审批", { setting: "skills.writeApprovalRequired" });
    }
    return this.repository.setEnabled(id, enabled);
  }

  /**
   * 选择本轮技能并组装 Prompt。
   * 打分 = 优先级 + 触发词命中数×10 + 显式请求 +1000；显式请求或命中触发词才入围，
   * 再按数量上限与 Token 预算逐个加载，超限技能记入 skipped。
   */
  async select(
    input: NovelSkillPreviewInput,
    config: Pick<AppConfig, "skills" | "features">
  ): Promise<NovelSkillSelection> {
    const metadata = await this.repository.list();
    const baseTrace = {
      schemaVersion: "skill-selection-trace.v1" as const,
      operation: input.operation,
      metadataScanned: metadata.length,
      maxLoadedSkills: config.skills.maxLoadedSkills,
      promptTokenBudget: config.skills.promptTokenBudget,
      totalEstimatedTokens: 0,
      selected: [],
      skipped: [],
      degradedReasons: []
    };
    if (!config.features.skills || !config.skills.enabled) {
      return { prompt: "", trace: { ...baseTrace, degradedReasons: ["技能系统未启用。"] } };
    }

    const requested = new Set(input.requestedSkillIds);
    // 匹配语料 = 用户指令 + 上下文，统一小写做触发词模糊匹配
    const corpus = `${input.instruction}\n${input.context}`.toLocaleLowerCase();
    const candidates = metadata
      .filter((skill) => skill.enabled && skill.appliesTo.includes(input.operation))
      .map((skill) => {
        const matchedTerms = skill.triggerTerms.filter((term) => corpus.includes(term.toLocaleLowerCase()));
        const explicit = requested.has(skill.id);
        return { skill, explicit, matchedTerms, score: skill.priority + matchedTerms.length * 10 + (explicit ? 1_000 : 0) };
      })
      .filter((candidate) => candidate.explicit || candidate.matchedTerms.length > 0)
      .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id));

    const skipped = [
      ...metadata
        .filter((skill) => requested.has(skill.id) && !skill.enabled)
        .map((skill) => ({ id: skill.id, reason: "技能已停用" })),
      ...metadata
        .filter((skill) => requested.has(skill.id) && !skill.appliesTo.includes(input.operation))
        .map((skill) => ({ id: skill.id, reason: `不适用于 ${input.operation}` }))
    ];
    const selected: NovelSkillSelection["trace"]["selected"] = [];
    const blocks: string[] = [];
    let totalTokens = 0;
    for (const candidate of candidates) {
      if (selected.length >= config.skills.maxLoadedSkills) {
        skipped.push({ id: candidate.skill.id, reason: "已达到技能数量上限" });
        continue;
      }
      const detail = await this.repository.get(candidate.skill.id);
      // 预算保护：剩余 Token 不足时跳过（而不是截断后仍塞入，避免指令内容被腰斩失去效力）
      const budgetRemaining = config.skills.promptTokenBudget - totalTokens;
      if (budgetRemaining <= 0) {
        skipped.push({ id: candidate.skill.id, reason: "已达到技能 Token 预算" });
        continue;
      }
      const included = truncateToTokens(detail.instructions, budgetRemaining);
      const includedTokens = estimateTokens(included);
      if (!included.trim()) {
        skipped.push({ id: candidate.skill.id, reason: "技能 Token 预算不足" });
        continue;
      }
      const truncated = includedTokens < detail.metadata.instructionEstimatedTokens;
      selected.push({
        id: detail.metadata.id,
        name: detail.metadata.name,
        score: candidate.score,
        explicit: candidate.explicit,
        matchedTerms: candidate.matchedTerms,
        includedEstimatedTokens: includedTokens,
        truncated,
        instructionHash: detail.metadata.instructionHash
      });
      blocks.push(`【技能：${detail.metadata.name}】\n${included}`);
      totalTokens += includedTokens;
      if (truncated) skipped.push({ id: detail.metadata.id, reason: "技能内容按 Token 预算截断" });
    }

    return {
      prompt: blocks.join("\n\n"),
      trace: {
        ...baseTrace,
        totalEstimatedTokens: totalTokens,
        selected,
        skipped,
        degradedReasons: skipped.some((item) => item.reason.includes("预算") || item.reason.includes("上限"))
          ? ["部分匹配技能未加载或被截断，已受配置预算保护。"]
          : []
      }
    };
  }
}

/** 在 Token 预算内截断技能指令：超预算时二分逼近最长可容纳前缀。 */
function truncateToTokens(content: string, maxTokens: number) {
  if (estimateTokens(content) <= maxTokens) return content;
  const chars = Array.from(content);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(chars.slice(0, middle).join("")) <= maxTokens) low = middle;
    else high = middle - 1;
  }
  return chars.slice(0, low).join("");
}
