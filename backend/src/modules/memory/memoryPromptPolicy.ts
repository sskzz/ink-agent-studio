/**
 * Memory Prompt 策略常量。
 * 职责：统一 Memory 注入时的来源标签与包装开销常量，让选择器与 PromptAssembler 的预算计算保持一致；
 * 边界：纯常量模块；修改标签文案时必须同步估算 token 数。
 */
import { estimateTokens } from "../prompts/promptAssembler.js";

/** Memory 层统一标签；选择器需要为 PromptAssembler 自动渲染的标签预留预算。 */
export const userMemoryPromptSourceLabel = "偏好";
/** 标签包装（【偏好】+ 换行）的 Token 开销，选择预算时扣除。 */
export const userMemoryPromptWrapperTokens = estimateTokens(`【${userMemoryPromptSourceLabel}】\n`);
