import { Hono } from "hono";
import { getRun } from "../modules/agents/runRepository.js";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { jsonOk } from "../utils/http.js";

export const runsRoute = new Hono();

function paths() {
  return createWorkspacePaths();
}

runsRoute.get("/runs/:runId", async (context) => {
  const run = await getRun(paths(), context.req.param("runId"), context.req.query("bookId"));
  return jsonOk(context, run);
});

runsRoute.get("/runs/:runId/events", async (context) => {
  const run = await getRun(paths(), context.req.param("runId"), context.req.query("bookId"));
  const payload = `event: done\ndata: ${JSON.stringify(run)}\n\n`;

  return new Response(payload, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    }
  });
});
