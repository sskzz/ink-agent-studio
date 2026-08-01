import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pathExists } from "../../utils/fileStore.js";
import { createWorkspacePaths } from "./workspacePaths.js";
import { ensureWorkspace, getWorkspaceSummary } from "./workspaceService.js";

let tempRoot: string | null = null;

afterEach(async () => {
  if (tempRoot) {
    await rm(tempRoot, { recursive: true, force: true });
    tempRoot = null;
  }
});

describe("workspaceService", () => {
  it("初始化本地工作区目录和索引文件", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-workspace-"));
    const paths = createWorkspacePaths(tempRoot);

    await ensureWorkspace(paths);

    await expect(pathExists(paths.configDir)).resolves.toBe(true);
    await expect(pathExists(paths.skillsDir)).resolves.toBe(true);
    await expect(pathExists(paths.backupsDir)).resolves.toBe(true);
    await expect(pathExists(paths.logsDir)).resolves.toBe(true);
    await expect(pathExists(paths.booksIndexFile)).resolves.toBe(true);
    await expect(pathExists(paths.modelConfigsFile)).resolves.toBe(true);
    await expect(pathExists(paths.modelRoutesFile)).resolves.toBe(true);
    await expect(pathExists(paths.runsLogFile)).resolves.toBe(true);
  });

  it("返回工作区摘要", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "ink-agent-workspace-"));
    const paths = createWorkspacePaths(tempRoot);

    const summary = await getWorkspaceSummary(paths);

    expect(summary.root).toBe(paths.root);
    expect(summary.booksCount).toBe(0);
    expect(summary.modelConfigsCount).toBe(0);
  });
});
