import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspacePaths } from "../modules/workspace/workspacePaths.js";
import { ensureWorkspace } from "../modules/workspace/workspaceService.js";
import { pathExists } from "../utils/fileStore.js";
import { WorkspaceLease } from "./workspaceLease.js";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

async function createLease() {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-lease-"));
  const paths = createWorkspacePaths(tempRoot);
  await ensureWorkspace(paths);
  return { paths, lease: new WorkspaceLease(paths) };
}

describe("WorkspaceLease", () => {
  it("acquires and releases the workspace lock", async () => {
    const { paths, lease } = await createLease();

    await lease.acquire();

    const record = JSON.parse(await readFile(paths.workspaceLockFile, "utf8")) as { pid: number };
    expect(record.pid).toBe(process.pid);
    await lease.release();
    await expect(pathExists(paths.workspaceLockFile)).resolves.toBe(false);
  });

  it("rejects another writer while the owner process is alive", async () => {
    const { paths, lease } = await createLease();
    const competingLease = new WorkspaceLease(paths);
    await lease.acquire();

    await expect(competingLease.acquire()).rejects.toMatchObject({ status: 409 });

    await lease.release();
    await expect(competingLease.acquire()).resolves.toBeUndefined();
    await competingLease.release();
  });

  it("replaces a stale lock left by a dead process", async () => {
    const { paths, lease } = await createLease();
    await writeFile(paths.workspaceLockFile, JSON.stringify({
      token: "stale-token",
      pid: 2_147_483_647,
      startedAt: "2025-01-01T00:00:00.000Z"
    }), "utf8");

    await expect(lease.acquire()).resolves.toBeUndefined();
    const record = JSON.parse(await readFile(paths.workspaceLockFile, "utf8")) as { pid: number };
    expect(record.pid).toBe(process.pid);
    await lease.release();
  });
});
