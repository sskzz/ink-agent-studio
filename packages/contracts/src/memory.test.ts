/**
 * 文件职责：memory.ts 契约的单元测试，覆盖偏好提议交叉校验与审批字面量校验。
 */
import { describe, expect, it } from "vitest";
import {
  userPreferenceApprovalInputSchema,
  userPreferenceProposalInputSchema
} from "./memory.js";

describe("user preference contracts", () => {
  it("requires a source session whenever a source message is linked", () => {
    expect(() => userPreferenceProposalInputSchema.parse({
      category: "writing",
      key: "paragraph_length",
      value: "使用短段落",
      reason: "长期偏好",
      priority: 50,
      sourceSessionId: null,
      sourceMessageId: "message-1"
    })).toThrow("来源 Session");
  });

  it("requires literal approval", () => {
    expect(userPreferenceApprovalInputSchema.parse({ approved: true })).toEqual({ approved: true });
    expect(() => userPreferenceApprovalInputSchema.parse({ approved: false })).toThrow();
  });
});
