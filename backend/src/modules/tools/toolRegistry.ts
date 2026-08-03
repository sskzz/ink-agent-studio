/**
 * 文件职责：Agent 工具的注册表与执行器：注册去重、输入 schema 校验、执行前后的事件审计。
 * 边界：只负责"注册/执行/审计"框架，具体工具行为由各工具的 execute 实现（含安全策略）。
 */
import { z, type ZodType } from "zod";
import type { PatchService } from "../patches/patchService.js";
import type { RunEventStore } from "../agents/runEventStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

/** 工具执行上下文：作品路径、可选的 Run 追踪信息与 Patch 服务（写能力只能经它提交）。 */
export interface ToolExecutionContext {
  paths: WorkspacePaths;
  bookId: string;
  runId?: string;
  eventStore?: RunEventStore;
  patchService?: PatchService;
}

/** 工具定义：名称、说明、入参 schema、是否需审批、执行函数。 */
export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  requiresApproval: boolean;
  execute(context: ToolExecutionContext, input: I): Promise<O>;
}

/** 工具注册表：同名工具不可重复注册；执行时先 schema 校验，再记录 tool_started/tool_completed 事件。 */
export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition<unknown, unknown>>();

  register<I, O>(definition: ToolDefinition<I, O>) {
    if (this.definitions.has(definition.name)) throw new Error(`工具已注册：${definition.name}`);
    this.definitions.set(definition.name, definition as ToolDefinition<unknown, unknown>);
    return this;
  }

  /** 列出工具摘要（名称/说明/是否需审批），供 Agent 与前端展示。 */
  list() {
    return [...this.definitions.values()].map(({ name, description, requiresApproval }) => ({
      name,
      description,
      requiresApproval
    }));
  }

  /**
   * 执行工具。
   * 校验失败或执行异常都会记录 tool_completed(ok=false) 事件后原样抛出；
   * 错误信息只取 message，不把堆栈写入事件。
   */
  async execute(name: string, context: ToolExecutionContext, rawInput: unknown) {
    const definition = this.definitions.get(name);
    if (!definition) throw new Error(`工具不存在：${name}`);
    const input = definition.inputSchema.parse(rawInput);
    const eventStore = context.eventStore;
    if (eventStore && context.runId) {
      eventStore.appendEvent(context.runId, {
        type: "tool_started",
        payload: { toolName: name, requiresApproval: definition.requiresApproval }
      });
    }

    try {
      const output = await definition.execute(context, input);
      if (eventStore && context.runId) {
        eventStore.appendEvent(context.runId, {
          type: "tool_completed",
          payload: { toolName: name, ok: true, output }
        });
      }
      return output;
    } catch (error) {
      if (eventStore && context.runId) {
        eventStore.appendEvent(context.runId, {
          type: "tool_completed",
          payload: { toolName: name, ok: false, error: error instanceof Error ? error.message : String(error) }
        });
      }
      throw error;
    }
  }
}

/** Agent 可调用的工具名单（与 novelToolRegistry 注册的工具一一对应）。 */
export const toolNameSchema = z.enum([
  "search_chapters",
  "get_entity",
  "read_story_state",
  "review_draft",
  "propose_state_patch"
]);
