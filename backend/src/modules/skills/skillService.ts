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

  list() {
    return this.repository.list();
  }

  get(id: string) {
    return this.repository.get(id);
  }

  async create(input: Omit<NovelSkillCreateInput, "approved"> & { approved: boolean }, config: AppConfig) {
    if (!input.approved) throw conflict("创建自定义技能需要明确审批", { setting: "skills.writeApprovalRequired" });
    const { approved: _approved, ...definition } = input;
    return this.repository.create(definition);
  }

  async setEnabled(id: string, enabled: boolean, approved: boolean, config: AppConfig) {
    if (config.skills.writeApprovalRequired && !approved) {
      throw conflict("修改技能启用状态需要明确审批", { setting: "skills.writeApprovalRequired" });
    }
    return this.repository.setEnabled(id, enabled);
  }

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
