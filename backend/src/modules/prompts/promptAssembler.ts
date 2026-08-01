import { sha256 } from "../../utils/hash.js";

export type PromptLayerName = "stable" | "facts" | "memory" | "scene" | "skills" | "turn";

export interface PromptSource {
  id: string;
  label: string;
  content: string;
  priority: number;
  maxTokens?: number;
  minTokens?: number;
  truncateFrom?: "head" | "tail";
  sourceRef?: Record<string, unknown>;
}

export interface PromptLayerInput {
  name: PromptLayerName;
  budgetTokens: number;
  sources: PromptSource[];
}

export interface PromptLayerTrace {
  name: PromptLayerName;
  budgetTokens: number;
  estimatedTokens: number;
  contentHash: string;
  truncated: boolean;
  sources: Array<{
    id: string;
    sourceRef: Record<string, unknown> | null;
    originalEstimatedTokens: number;
    includedEstimatedTokens: number;
    truncated: boolean;
  }>;
}

export interface PromptAssembly {
  systemPrompt: string;
  userPrompt: string;
  trace: {
    schemaVersion: "prompt-trace.v1";
    estimator: "heuristic-cjk.v1";
    promptHash: string;
    totalEstimatedTokens: number;
    layers: PromptLayerTrace[];
  };
}

/**
 * 按稳定规则、作品事实、用户偏好、场景上下文、小说技能、当前指令装配 Prompt。超出预算时优先缩减低优先级
 * 来源；当前指令可设置较高优先级和 minTokens，避免长篇世界观把本轮目标挤出上下文。
 */
export class PromptAssembler {
  assemble(layers: PromptLayerInput[]): PromptAssembly {
    const expected: PromptLayerName[] = ["stable", "facts", "memory", "scene", "skills", "turn"];
    if (layers.length !== expected.length || layers.some((layer, index) => layer.name !== expected[index])) {
      throw new Error("Prompt 必须按 stable、facts、memory、scene、skills、turn 六层提供");
    }

    const assembled = layers.map(assembleLayer);
    const systemPrompt = assembled[0].content;
    const userPrompt = assembled.slice(1).map((layer) => layer.content).filter(Boolean).join("\n\n");
    return {
      systemPrompt,
      userPrompt,
      trace: {
        schemaVersion: "prompt-trace.v1",
        estimator: "heuristic-cjk.v1",
        promptHash: sha256(`${systemPrompt}\n\n${userPrompt}`),
        totalEstimatedTokens: estimateTokens(systemPrompt) + estimateTokens(userPrompt),
        layers: assembled.map((layer) => layer.trace)
      }
    };
  }
}

export function estimateTokens(content: string) {
  const cjk = (content.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const nonCjk = content.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, "");
  const latinWords = (nonCjk.match(/[A-Za-z0-9_]+/g) ?? []).length;
  const other = nonCjk.replace(/[A-Za-z0-9_\s]/g, "").length;
  return Math.max(1, cjk + latinWords + Math.ceil(other / 2));
}

function assembleLayer(layer: PromptLayerInput) {
  if (!Number.isInteger(layer.budgetTokens) || layer.budgetTokens <= 0) {
    throw new Error(`${layer.name} Prompt 层预算必须是正整数`);
  }

  const items = layer.sources.map((source, index) => {
    const originalTokens = estimateTokens(source.content);
    const initialLimit = Math.max(0, Math.min(source.maxTokens ?? originalTokens, originalTokens));
    const content = truncateToTokens(source.content, initialLimit, source.truncateFrom ?? "tail");
    return {
      source,
      index,
      originalTokens,
      content,
      minTokens: Math.min(initialLimit, Math.max(0, source.minTokens ?? 0))
    };
  });

  const render = () => items
    .sort((left, right) => left.index - right.index)
    .filter((item) => item.content.trim())
    .map((item) => `【${item.source.label}】\n${item.content.trim()}`)
    .join("\n\n");

  let content = render();
  for (const item of [...items].sort((left, right) => left.source.priority - right.source.priority || left.index - right.index)) {
    if (estimateTokens(content) <= layer.budgetTokens) break;
    const currentTokens = estimateTokens(item.content);
    const excess = estimateTokens(content) - layer.budgetTokens;
    const nextTokens = Math.max(item.minTokens, currentTokens - excess);
    item.content = truncateToTokens(item.content, nextTokens, item.source.truncateFrom ?? "tail");
    content = render();
  }

  if (estimateTokens(content) > layer.budgetTokens) {
    content = truncateToTokens(content, layer.budgetTokens, "head");
  }

  const trace: PromptLayerTrace = {
    name: layer.name,
    budgetTokens: layer.budgetTokens,
    estimatedTokens: estimateTokens(content),
    contentHash: sha256(content),
    truncated: items.some((item) => estimateTokens(item.content) < item.originalTokens),
    sources: items.sort((left, right) => left.index - right.index).map((item) => ({
      id: item.source.id,
      sourceRef: item.source.sourceRef ?? null,
      originalEstimatedTokens: item.originalTokens,
      includedEstimatedTokens: estimateTokens(item.content),
      truncated: estimateTokens(item.content) < item.originalTokens
    }))
  };
  return { content, trace };
}

function truncateToTokens(content: string, maxTokens: number, from: "head" | "tail") {
  if (maxTokens <= 0) return "";
  if (estimateTokens(content) <= maxTokens) return content;

  const characters = Array.from(content);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = from === "tail" ? characters.slice(-middle).join("") : characters.slice(0, middle).join("");
    if (estimateTokens(candidate) <= maxTokens) low = middle;
    else high = middle - 1;
  }
  return from === "tail" ? characters.slice(-low).join("") : characters.slice(0, low).join("");
}
