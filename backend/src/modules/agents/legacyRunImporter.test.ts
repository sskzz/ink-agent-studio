import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeDatabase } from "../../runtime/database/runtimeDatabase.js";
import { createWorkspacePaths } from "../workspace/workspacePaths.js";
import { ensureWorkspace } from "../workspace/workspaceService.js";
import { LegacyRunImporter } from "./legacyRunImporter.js";
import { RunEventStore } from "./runEventStore.js";

let tempRoot: string | null = null;
let runtimeDatabase: RuntimeDatabase | null = null;

afterEach(async () => {
  runtimeDatabase?.close();
  runtimeDatabase = null;
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("LegacyRunImporter", () => {
  it("imports snapshots idempotently and records corrupt lines", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-legacy-runs-"));
    const paths = createWorkspacePaths(tempRoot);
    await ensureWorkspace(paths);
    const startedAt = "2026-01-01T00:00:00.000Z";
    const running = {
      id: "legacy-run-1",
      bookId: "book-1",
      runType: "chapter_continue",
      status: "running",
      inputJson: { instruction: "继续" },
      outputJson: null,
      modelConfigId: null,
      promptVersion: null,
      tokenUsageJson: null,
      styleTraceJson: null,
      errorMessage: null,
      startedAt,
      finishedAt: null
    };
    const completed = {
      ...running,
      status: "completed",
      outputJson: { draft: "已完成" },
      finishedAt: "2026-01-01T00:01:00.000Z"
    };
    await writeFile(paths.runsLogFile, `${JSON.stringify(running)}\n${JSON.stringify(completed)}\n{bad json\n`, "utf8");
    runtimeDatabase = new RuntimeDatabase(paths);
    await runtimeDatabase.initialize({ busyTimeoutMs: 1_000, backupBeforeMigration: false });
    const importer = new LegacyRunImporter(runtimeDatabase, paths);

    await expect(importer.import()).resolves.toEqual({ imported: 2, skipped: 0, invalid: 1 });
    const store = new RunEventStore(runtimeDatabase);
    expect(store.getRun("legacy-run-1")).toMatchObject({
      status: "completed",
      output: { draft: "已完成" }
    });
    await expect(importer.import()).resolves.toEqual({ imported: 0, skipped: 3, invalid: 0 });
  });
});
