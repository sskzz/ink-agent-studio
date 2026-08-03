/**
 * 会话服务。
 * 职责：会话（Session）与消息的创建/查询/搜索/归档，搜索结果的摘要裁剪；
 * 边界：limit 一律受配置约束并夹到 [1, 1000]，防止一次查询拖垮 SQLite；搜索只读不改数据。
 */
import { sessionCreateInputSchema, sessionSearchInputSchema } from "@ink-agent/contracts";
import type { ConfigService } from "../../config/configService.js";
import { SessionRepository } from "./sessionRepository.js";

export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly configService: Pick<ConfigService, "get">
  ) {}

  /** 创建会话（可挂父会话，形成会话树）。 */
  create(rawInput: unknown) {
    return this.repository.create(sessionCreateInputSchema.parse(rawInput));
  }

  /** 按 id 读取会话；不存在时抛 notFound。 */
  get(sessionId: string) {
    return this.repository.get(sessionId);
  }

  /** 列出会话：可按作品过滤；limit 受配置约束。 */
  async list(options: { bookId?: string; limit?: number } = {}) {
    const config = await this.configService.get();
    const limit = Math.min(1_000, Math.max(1, Math.trunc(options.limit ?? config.sessions.searchResultLimit)));
    return this.repository.list({ bookId: options.bookId, limit });
  }

  /** 向会话追加消息（schema 校验在仓储层完成）。 */
  addMessage(sessionId: string, rawInput: unknown) {
    return this.repository.addMessage(sessionId, rawInput);
  }

  /** 列出会话消息（时间正序）；limit 受配置的 recentMessageLimit 约束。 */
  async listMessages(sessionId: string, limit?: number) {
    const config = await this.configService.get();
    const bounded = Math.min(1_000, Math.max(1, Math.trunc(limit ?? config.sessions.recentMessageLimit)));
    return this.repository.listMessages(sessionId, bounded);
  }

  /** 全文搜索消息（FTS 优先，回退 LIKE）；摘要围绕首个命中位置裁剪。 */
  async search(rawInput: unknown) {
    const input = sessionSearchInputSchema.parse(rawInput);
    const config = await this.configService.get();
    const limit = input.limit ?? config.sessions.searchResultLimit;
    return this.repository.search({ ...input, limit }).map((result) => ({
      ...result,
      snippet: clipAroundMatch(result.snippet, input.query, config.sessions.searchSnippetCharacters)
    }));
  }

  /** 归档会话（幂等）。 */
  archive(sessionId: string) {
    return this.repository.archive(sessionId);
  }
}

/** 摘要裁剪：围绕查询词首个命中位置取前后片段，超长时两侧补省略号。 */
function clipAroundMatch(content: string, query: string, maxCharacters: number) {
  if (content.length <= maxCharacters) return content;
  const index = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, (index < 0 ? 0 : index) - Math.floor(maxCharacters / 3));
  return `${start > 0 ? "…" : ""}${content.slice(start, start + maxCharacters)}${start + maxCharacters < content.length ? "…" : ""}`;
}
