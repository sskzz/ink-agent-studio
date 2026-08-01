import { estimateTokens } from "../prompts/promptAssembler.js";

/** Memory 层统一标签；选择器需要为 PromptAssembler 自动渲染的标签预留预算。 */
export const userMemoryPromptSourceLabel = "偏好";
export const userMemoryPromptWrapperTokens = estimateTokens(`【${userMemoryPromptSourceLabel}】\n`);
