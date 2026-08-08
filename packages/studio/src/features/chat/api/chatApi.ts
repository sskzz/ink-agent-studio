/**
 * 对话 API：编辑器右侧 AI 会话的模型生成调用（对应后端 routes/chat.ts）。
 * 请求携带绑定条目的内容快照与历史消息，后端用写作模型生成回复；
 * 模型未配置/密钥缺失时后端返回 400，错误文案直接展示给用户。
 */
import { apiPost } from "@/shared/api/http";

/** 发送给后端的单条历史消息（作者 + 内容，按时间升序）。 */
export interface ChatHistoryMessage {
  author: string;
  content: string;
}

/** 对话请求：绑定条目上下文（内容快照）+ 历史消息。 */
export interface ChatRequest {
  /** 绑定条目标题（用于提示词标注上下文来源）。 */
  itemTitle?: string;
  /** 绑定条目的内容快照（设定 markdown / 章节正文）。 */
  context?: string;
  messages: ChatHistoryMessage[];
}

/** 对话回复：模型生成的正文文本与来源模型。 */
export interface ChatReply {
  reply: string;
  model: string;
}

/** 发送一条 AI 对话请求，返回模型回复。 */
export async function sendAssistantMessage(input: ChatRequest): Promise<ChatReply> {
  return apiPost<ChatReply>("/chat", input);
}
