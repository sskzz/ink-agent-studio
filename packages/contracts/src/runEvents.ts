/**
 * 文件职责：定义运行（Run）事件流契约。
 * 后端把 Run 的执行过程拆成有序事件（seq 递增）推送给前端做实时进度展示；
 * 前端据此渲染状态、token 消耗、工具调用等。
 */
import { z } from "zod";
import { isoDateTimeSchema, nonNegativeIntegerSchema } from "./common.js";

/**
 * 事件类型：覆盖 Run 从排队到结束的完整生命周期。
 * 前端按 type 分流渲染；新增阶段时先在这里补充事件类型。
 */
export const runEventTypeSchema = z.enum([
  "run_created", // Run 已创建但尚未排队
  "run_queued", // 已进入队列等待调度
  "run_started", // 调度器开始执行
  "stage_started", // 进入某个执行阶段
  "stage_progress", // 阶段内进度更新
  "stage_completed", // 阶段完成
  "model_attempt_started", // 一次模型调用开始
  "model_delta", // 模型流式增量输出
  "model_attempt_completed", // 模型调用结束
  "tool_started", // 工具调用开始
  "tool_completed", // 工具调用结束
  "review_completed", // 人工/自动审查完成
  "degraded", // 运行降级（如上下文不足启用降级模式）
  "checkpoint_saved", // 检查点已保存
  "cancel_requested", // 收到取消请求
  "run_cancelled", // Run 已取消
  "run_completed", // Run 正常完成
  "run_failed", // Run 失败
  "run_interrupted" // Run 被中断（如进程重启）
]);

/** 单条事件记录：seq 在同 runId 内单调递增，保证回放顺序一致。 */
export const runEventSchema = z.object({
  schemaVersion: z.literal("run-event.v1"),
  runId: z.string().min(1),
  seq: nonNegativeIntegerSchema, // 同一 Run 内的事件序号，用于排序与去重
  eventId: z.string().min(1),
  type: runEventTypeSchema,
  stage: z.string().nullable(), // 关联的执行阶段名，无阶段事件为 null
  timestamp: isoDateTimeSchema,
  payload: z.record(z.unknown()), // 事件附加数据，按 type 约定结构
  artifactRefs: z.array(z.string()).default([]) // 关联的产物引用（文件、日志等）
}).strict();

export type RunEventType = z.infer<typeof runEventTypeSchema>;
export type RunEvent = z.infer<typeof runEventSchema>;
