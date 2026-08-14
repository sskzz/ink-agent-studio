import { describe, expect, it, vi } from "vitest";
import type { ModelConfigRecord } from "../../types/domain.js";
import { auditChapterSemanticKnowledge } from "./chapterSemanticKnowledgeAudit.js";

const model: ModelConfigRecord = {
  id: "review-model", name: "审稿", provider: "openai-compatible", baseUrl: "https://example.test", apiModel: "review",
  purpose: "review", enabled: true, isDefault: false, capabilities: {}, thinking: null, note: "", createdAt: "", updatedAt: ""
};

const deterministic = { schemaVersion: "chapter-knowledge-audit.v1" as const, passed: true, blockingIssues: [], warnings: [] };

function input() {
  return {
    bookId: "book-1", chapterNo: 3, content: "林夕沿着旧塔石阶找到月钥。", deterministicAudit: deterministic,
    plannedChapter: null, entities: [], worldRules: null, foreshadowing: [], reviewModel: model
  };
}

describe("chapter semantic knowledge audit", () => {
  it("本地没有疑点时不调用模型", async () => {
    const generateText = vi.fn();
    const report = await auditChapterSemanticKnowledge({} as never, input(), { generateText });
    expect(report).toMatchObject({ triggered: false, passed: true, issues: [] });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("有疑点时只调用一次，并允许 fingerprint 人工豁免", async () => {
    const suspicious = {
      ...input(),
      deterministicAudit: {
        ...deterministic,
        warnings: [{ code: "PLANNED_CHARACTER_NOT_EVIDENCED" as const, sourceId: "hero-lin", message: "章纲角色未显式出现" }]
      }
    };
    const generateText = vi.fn(async () => ({
      text: JSON.stringify({
        schemaVersion: "chapter-semantic-knowledge-audit.v1", passed: false,
        issues: [{ code: "CHARACTER_ACTION_SEMANTIC_CONFLICT", severity: "blocking", sourceId: "hero-lin", evidence: "未出现", reason: "计划行动没有发生", confidence: 0.9 }]
      }),
      provider: "openai-compatible" as const, model: "review", tokenUsage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 }
    }));
    const first = await auditChapterSemanticKnowledge({} as never, suspicious, { generateText });
    expect(generateText).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ triggered: true, passed: false, tokenUsage: { totalTokens: 30 } });
    const second = await auditChapterSemanticKnowledge({} as never, {
      ...suspicious,
      decisions: [{ fingerprint: first.issues[0].fingerprint, decision: "exempted" }]
    }, { generateText });
    expect(second).toMatchObject({ passed: true, issues: [{ decision: "exempted", effectiveSeverity: "warning" }] });
  });
});
