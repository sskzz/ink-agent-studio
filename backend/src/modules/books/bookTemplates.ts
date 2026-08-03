/**
 * 文件职责：作品核心 Markdown 文件的初始模板。
 * 边界：纯字符串生成，无 I/O；模板中的占位文案引导 AI 后续填充。
 */
import type { BookRecord } from "../../types/domain.js";

/** 故事基石（brief.md）模板：作品名、题材、创作方向、读者承诺；用户未提供简报时留 AI 补全位。 */
export function createBriefMarkdown(book: BookRecord, userBrief = "") {
  return `# 故事基石

## 作品名称
${book.title || "待 AI 补全"}

## 题材
${book.genre || "待 AI 补全"}

## 创作方向
${userBrief || "待 AI 根据作品属性生成可修改的作品简报。"}

## 读者承诺
- 保持人物行为一致。
- 保持世界观规则稳定。
- 每章推进情节、情绪或伏笔中的至少一项。
`;
}

/** 卷纲规划（outline.md）模板：章节推进计划与节奏规则。 */
export function createOutlineMarkdown() {
  return `# 卷纲规划

## 第一卷
待 AI 根据故事基石、世界观和角色设定生成章节推进计划。

## 节奏规则
- 每章有明确推进目标。
- 伏笔投放和回收需要写入伏笔池。
- 不直接覆盖用户已有设定。
`;
}

/** 世界观（world.md）模板：优先使用用户上传的世界观内容，否则生成占位并记录上传文件名。 */
export function createWorldMarkdown(worldFileName = "", worldFileContent = "") {
  if (worldFileContent.trim()) {
    return worldFileContent;
  }

  return `# 世界观

${worldFileName ? `已记录用户上传的世界观文件：${worldFileName}` : "待 AI 根据作品简介、题材和角色方向生成 world.md。"}

## 基础规则
- 世界观规则需要通过事件和细节逐步呈现。
- 后续修改必须同步更新当前状态和连续性检查。
`;
}

/** 当前状态（current.md）模板：已公开信息、未公开伏笔、下一章目标。 */
export function createCurrentStateMarkdown() {
  return `# 当前状态

## 已公开信息
- 待补充。

## 未公开伏笔
- 待补充。

## 下一章目标
- 待补充。
`;
}

/** 伏笔池（foreshadowing.md）模板：伏笔投放/回收计划的 Markdown 表格。 */
export function createForeshadowingMarkdown() {
  return `# 伏笔池

| 伏笔 | 投放章节 | 回收计划 | 状态 |
| --- | --- | --- | --- |
| 待补充 | 待补充 | 待补充 | planned |
`;
}
