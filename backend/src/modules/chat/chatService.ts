/**
 * 对话服务：把编辑器右侧 AI 会话的请求转发给写作模型生成回复。
 * 职责：校验请求 → 解析写作模型（路由配置，无配置/已停用 → 明确报错）→
 * 组装提示词（系统角色 + 绑定条目内容上下文 + 历史消息）→ 调用模型网关 → 返回回复文本。
 * 边界：不持久化会话（前端按条目缓存消息），不做记忆/技能注入（后续可扩展）。
 */
import { z } from "zod";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";
import { generateModelText } from "../ai/modelGateway.js";
import { getModelConfig, getModelRoutes } from "../models/modelConfigRepository.js";
import { badRequest } from "../../utils/errors.js";

/** 对话请求：绑定条目上下文（内容快照）+ 按时间升序的历史消息。 */
export const chatRequestSchema = z.object({
  /** 绑定条目的标题（用于提示词标注上下文来源）。 */
  itemTitle: z.string().max(100).optional().default("未命名条目"),
  /** 绑定条目的内容快照（设定 markdown / 章节正文），上限 6000 字符。 */
  context: z.string().max(6_000).optional().default(""),
  /** 历史消息（升序），上限 50 条，防止上下文无限膨胀。 */
  messages: z.array(z.object({
    author: z.string().max(20),
    content: z.string().min(1).max(20_000)
  })).min(1).max(50)
});

/** 对话回复：reply 为模型生成的正文文本。 */
export interface ChatReply {
  reply: string;
  model: string;
}

/**
 * 生成对话回复：把"绑定条目内容 + 历史消息"组装进提示词后调用写作模型。
 * 无写作模型路由或模型停用 → badRequest（提示先配置模型）。
 */
export async function generateChatReply(paths: WorkspacePaths, body: unknown): Promise<ChatReply> {
  const input = chatRequestSchema.parse(body);
  const routes = await getModelRoutes(paths);
  if (!routes.writingModelId) {
    throw badRequest("尚未配置写作模型，无法进行 AI 对话：请在模型设置中选择写作模型");
  }
  const model = await getModelConfig(paths, routes.writingModelId);
  if (!model.enabled) {
    throw badRequest("写作模型已停用，无法进行 AI 对话：请在模型设置中启用");
  }

  const systemPrompt = [
    "你是小说创作助手，帮助作者围绕当前作品推进写作。",
    `当前对话绑定「${input.itemTitle}」，回复应围绕该条目的内容展开。`,
    input.context
      ? `【绑定条目内容】\n${input.context}`
      : "当前条目没有可用的内容快照，请基于对话历史直接回答。",
    "要求：回答简洁具体、贴合创作语境；涉及设定时以绑定条目内容为准，不编造条目中不存在的设定。"
  ].join("\n\n");

  const history = input.messages
    .map((message) => `${message.author === "我" ? "用户" : "助手"}：${message.content}`)
    .join("\n\n");

  const result = await generateModelText(paths, model, {
    systemPrompt,
    userPrompt: history || "（无历史消息）",
    temperature: 0.8,
    maxTokens: 2_000,
    stream: false,
    timeoutMs: 120_000,
    responseFormat: "text"
  });

  return { reply: result.text, model: result.model };
}
