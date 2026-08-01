import { z } from "zod";
import { getChapter, listChapters } from "../books/chapterService.js";
import { getEntity } from "../books/entityService.js";
import { getBookFileContent } from "../files/fileService.js";
import { PatchService } from "../patches/patchService.js";
import { compileAntiAiPolicy } from "../review/antiAi/antiAiConstraintCompiler.js";
import { evaluateAntiAiCompliance } from "../review/antiAi/antiAiLocalReviewer.js";
import { ToolRegistry } from "./toolRegistry.js";

const searchChaptersInput = z.object({ query: z.string().default(""), limit: z.number().int().min(1).max(20).default(5) }).strict();
const entityInput = z.object({ entityId: z.string().min(1) }).strict();
const stateInput = z.object({ file: z.enum(["brief", "world", "current_state", "foreshadowing"]) }).strict();
const draftInput = z.object({ draft: z.string().min(1).max(200_000) }).strict();
const patchInput = z.object({
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("book_file"), fileId: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("chapter"), chapterId: z.string().min(1) }).strict()
  ]),
  proposedContent: z.string(),
  reason: z.string().min(1)
}).strict();

/** 小说域工具的集中注册入口。只读工具直接读取 BookState，写相关能力只能提交 Patch。 */
export function createNovelToolRegistry() {
  return new ToolRegistry()
    .register({
      name: "search_chapters",
      description: "在当前作品章节标题和正文中检索关键词并返回短片段。",
      inputSchema: searchChaptersInput,
      requiresApproval: false,
      async execute(context, input) {
        const chapters = await listChapters(context.paths, context.bookId);
        const query = (input.query ?? "").trim().toLocaleLowerCase();
        const results = [];
        for (const chapter of chapters) {
          if (results.length >= (input.limit ?? 5)) break;
          const full = await getChapter(context.paths, context.bookId, chapter.id);
          if (!query || `${chapter.title}\n${full.content}`.toLocaleLowerCase().includes(query)) {
            const index = query ? full.content.toLocaleLowerCase().indexOf(query) : 0;
            const start = Math.max(0, index - 120);
            results.push({
              chapterId: chapter.id,
              title: chapter.title,
              snippet: full.content.slice(start, start + 360)
            });
          }
        }
        return { query: input.query, results };
      }
    })
    .register({
      name: "get_entity",
      description: "读取角色、势力、地点或物品的当前权威记录。",
      inputSchema: entityInput,
      requiresApproval: false,
      execute: (context, input) => getEntity(context.paths, context.bookId, input.entityId)
    })
    .register({
      name: "read_story_state",
      description: "读取作品基石、世界观、当前状态或伏笔池。",
      inputSchema: stateInput,
      requiresApproval: false,
      async execute(context, input) {
        const fileId = input.file === "current_state" ? "current-state" : input.file;
        const file = await getBookFileContent(context.paths, context.bookId, fileId);
        return { file: input.file, content: file.content, contentHash: file.contentHash };
      }
    })
    .register({
      name: "review_draft",
      description: "对未写入正文的草稿执行本地去 AI 味规则检查。",
      inputSchema: draftInput,
      requiresApproval: false,
      async execute(_context, input) {
        const policy = compileAntiAiPolicy({ sceneType: "mixed" });
        return evaluateAntiAiCompliance(input.draft, policy);
      }
    })
    .register({
      name: "propose_state_patch",
      description: "根据当前权威内容生成待审批 Patch，不会直接修改作品文件。",
      inputSchema: patchInput,
      requiresApproval: false,
      async execute(context, input) {
        if (!context.runId || !context.patchService) throw new Error("propose_state_patch 必须在可追踪 Run 中调用");
        return context.patchService.propose(context.runId, {
          bookId: context.bookId,
          target: input.target,
          proposedContent: input.proposedContent,
          reason: input.reason
        });
      }
    });
}
