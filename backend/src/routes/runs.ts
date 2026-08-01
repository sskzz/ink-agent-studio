import { runCreateRequestSchema } from "@ink-agent/contracts";
import { Hono } from "hono";
import type { ApplicationServices } from "../runtime/applicationServices.js";
import { badRequest, conflict } from "../utils/errors.js";
import { jsonOk } from "../utils/http.js";
import { createRunSseStream } from "../modules/agents/runSse.js";

export function createRunsRoute(services: ApplicationServices) {
  const route = new Hono();

  route.get("/runs", (context) => {
    const limit = parseLimit(context.req.query("limit"));
    return jsonOk(context, services.runEventStore.listRuns({
      bookId: context.req.query("bookId") || undefined,
      limit
    }));
  });

  route.post("/runs", async (context) => {
    const input = runCreateRequestSchema.parse(await context.req.json());
    const run = await services.runCoordinator.enqueue(input.command, input.parentRunId, {
      sessionId: input.sessionId,
      triggerMessageId: input.triggerMessageId
    });
    return jsonOk(context, {
      runId: run.id,
      status: "queued" as const,
      eventsUrl: `/api/v1/runs/${run.id}/events`,
      acceptedAt: run.createdAt
    }, "运行已进入队列", 202);
  });

  route.get("/runs/:runId", (context) => {
    return jsonOk(context, services.runEventStore.getRun(context.req.param("runId")));
  });

  route.get("/runs/:runId/model-attempts", (context) => {
    return jsonOk(context, services.runEventStore.listModelAttempts(context.req.param("runId")));
  });

  route.post("/runs/:runId/cancel", (context) => {
    return jsonOk(context, services.runCoordinator.cancel(context.req.param("runId")), "已处理取消请求");
  });

  route.post("/runs/:runId/resume", async (context) => {
    const run = await services.runCoordinator.resume(context.req.param("runId"));
    return jsonOk(context, {
      runId: run.id,
      status: "queued" as const,
      eventsUrl: `/api/v1/runs/${run.id}/events`,
      acceptedAt: run.updatedAt
    }, "运行已重新进入队列", 202);
  });

  route.get("/runs/:runId/events", async (context) => {
    const runId = context.req.param("runId");
    const snapshot = services.runEventStore.getRun(runId);
    const config = await services.configService.get();
    const afterSeq = parseAfterSeq(context.req.query("after") ?? context.req.header("Last-Event-ID"));
    const replayCount = snapshot.lastEventSeq - afterSeq;
    if (replayCount > config.events.replayLimit) {
      throw conflict("待重放事件数量超过上限，请先读取 Run 快照后从较新的 seq 续接", {
        runId,
        afterSeq,
        lastEventSeq: snapshot.lastEventSeq,
        replayLimit: config.events.replayLimit
      });
    }

    return new Response(createRunSseStream(runId, services.runEventStore, services.runEventHub, {
      afterSeq,
      replayLimit: config.events.replayLimit,
      heartbeatMs: config.events.heartbeatMs,
      terminalAtOpen: ["cancelled", "completed", "failed", "interrupted"].includes(snapshot.status)
    }), {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  });

  return route;
}

function parseAfterSeq(value: string | undefined) {
  if (value === undefined || value === "") return -1;
  if (!/^-?\d+$/.test(value)) throw badRequest("after 或 Last-Event-ID 必须是事件序号");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < -1) throw badRequest("事件序号超出有效范围");
  return parsed;
}

function parseLimit(value: string | undefined) {
  if (value === undefined || value === "") return 100;
  if (!/^\d+$/.test(value)) throw badRequest("limit 必须是正整数");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000) {
    throw badRequest("limit 必须在 1 到 1000 之间");
  }
  return parsed;
}
