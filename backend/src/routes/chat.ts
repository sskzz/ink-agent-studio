import { Hono } from "hono";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { generateChatReply } from "../modules/chat/chatService.js";
import { jsonOk } from "../utils/http.js";

/**
 * 对话路由：编辑器右侧 AI 会话的模型生成入口。
 */
export function createChatRoute(services: ApplicationServices) {
  const route = new Hono();

  /**
   * POST /api/v1/chat：AI 对话。
   * 入参：绑定条目上下文 + 历史消息；回复为写作模型生成的纯文本。
   * 模型未配置或已停用 → 400（提示在模型设置中配置写作模型）。
   */
  route.post("/chat", async (context) => {
    return jsonOk(context, await generateChatReply(services.paths, await context.req.json()));
  });

  return route;
}
