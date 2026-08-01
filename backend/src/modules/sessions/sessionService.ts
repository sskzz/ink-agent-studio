import { sessionCreateInputSchema, sessionSearchInputSchema } from "@ink-agent/contracts";
import type { ConfigService } from "../../config/configService.js";
import { SessionRepository } from "./sessionRepository.js";

export class SessionService {
  constructor(
    private readonly repository: SessionRepository,
    private readonly configService: Pick<ConfigService, "get">
  ) {}

  create(rawInput: unknown) {
    return this.repository.create(sessionCreateInputSchema.parse(rawInput));
  }

  get(sessionId: string) {
    return this.repository.get(sessionId);
  }

  async list(options: { bookId?: string; limit?: number } = {}) {
    const config = await this.configService.get();
    const limit = Math.min(1_000, Math.max(1, Math.trunc(options.limit ?? config.sessions.searchResultLimit)));
    return this.repository.list({ bookId: options.bookId, limit });
  }

  addMessage(sessionId: string, rawInput: unknown) {
    return this.repository.addMessage(sessionId, rawInput);
  }

  async listMessages(sessionId: string, limit?: number) {
    const config = await this.configService.get();
    const bounded = Math.min(1_000, Math.max(1, Math.trunc(limit ?? config.sessions.recentMessageLimit)));
    return this.repository.listMessages(sessionId, bounded);
  }

  async search(rawInput: unknown) {
    const input = sessionSearchInputSchema.parse(rawInput);
    const config = await this.configService.get();
    const limit = input.limit ?? config.sessions.searchResultLimit;
    return this.repository.search({ ...input, limit }).map((result) => ({
      ...result,
      snippet: clipAroundMatch(result.snippet, input.query, config.sessions.searchSnippetCharacters)
    }));
  }

  archive(sessionId: string) {
    return this.repository.archive(sessionId);
  }
}

function clipAroundMatch(content: string, query: string, maxCharacters: number) {
  if (content.length <= maxCharacters) return content;
  const index = content.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, (index < 0 ? 0 : index) - Math.floor(maxCharacters / 3));
  return `${start > 0 ? "…" : ""}${content.slice(start, start + maxCharacters)}${start + maxCharacters < content.length ? "…" : ""}`;
}
