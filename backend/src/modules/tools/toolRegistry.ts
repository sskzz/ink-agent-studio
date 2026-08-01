import { z, type ZodType } from "zod";
import type { PatchService } from "../patches/patchService.js";
import type { RunEventStore } from "../agents/runEventStore.js";
import type { WorkspacePaths } from "../workspace/workspacePaths.js";

export interface ToolExecutionContext {
  paths: WorkspacePaths;
  bookId: string;
  runId?: string;
  eventStore?: RunEventStore;
  patchService?: PatchService;
}

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  inputSchema: ZodType<I>;
  requiresApproval: boolean;
  execute(context: ToolExecutionContext, input: I): Promise<O>;
}

export class ToolRegistry {
  private readonly definitions = new Map<string, ToolDefinition<unknown, unknown>>();

  register<I, O>(definition: ToolDefinition<I, O>) {
    if (this.definitions.has(definition.name)) throw new Error(`工具已注册：${definition.name}`);
    this.definitions.set(definition.name, definition as ToolDefinition<unknown, unknown>);
    return this;
  }

  list() {
    return [...this.definitions.values()].map(({ name, description, requiresApproval }) => ({
      name,
      description,
      requiresApproval
    }));
  }

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

export const toolNameSchema = z.enum([
  "search_chapters",
  "get_entity",
  "read_story_state",
  "review_draft",
  "propose_state_patch"
]);
