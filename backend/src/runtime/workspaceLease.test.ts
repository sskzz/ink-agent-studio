// 工作区租约单测：加锁/释放、并发占用冲突、过期锁（进程已死）回收。
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

  // Windows 专属：PID 被系统复用给无关进程（后端已死但 pid 仍"存活"）时必须识别为过期锁。
  // 锁记录 pid 指向当前测试进程（存活），但 startedAt 早于该进程的真实创建时间 → PID 复用。
  // 非 Windows 平台无法查询进程创建时间，保守按占用处理，因此跳过。
  it.runIf(process.platform === "win32")("recovers a lock whose pid was recycled by an unrelated process", async () => {
    const { paths, lease } = await createLease();
    await writeFile(paths.workspaceLockFile, JSON.stringify({
      token: "recycled-token",
      // 用当前测试进程的 pid 模拟"存活进程"，但其创建时间必然晚于 2000 年 → 判定为 PID 复用
      pid: process.pid,
      startedAt: "2000-01-01T00:00:00.000Z"
    }), "utf8");

    await expect(lease.acquire()).resolves.toBeUndefined();
    const record = JSON.parse(await readFile(paths.workspaceLockFile, "utf8")) as { pid: number };
    expect(record.pid).toBe(process.pid);
    await lease.release();
  });
});
