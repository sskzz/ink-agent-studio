import { randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { conflict } from "../utils/errors.js";
import type { WorkspacePaths } from "../modules/workspace/workspacePaths.js";

interface WorkspaceLeaseRecord {
  token: string;
  pid: number;
  startedAt: string;
}

function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class WorkspaceLease {
  private token: string | null = null;

  constructor(private readonly paths: WorkspacePaths) {}

  async acquire() {
    if (this.token) return;
    const token = randomUUID();
    const record: WorkspaceLeaseRecord = {
      token,
      pid: process.pid,
      startedAt: new Date().toISOString()
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(this.paths.workspaceLockFile, "wx");
        try {
          await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
        } finally {
          await handle.close();
        }
        this.token = token;
        return;
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        const existing = await this.readExisting();

        if (existing && isProcessAlive(existing.pid)) {
          throw conflict("工作区已被另一个后端进程占用", {
            workspace: this.paths.root,
            pid: existing.pid,
            startedAt: existing.startedAt
          });
        }

        await unlink(this.paths.workspaceLockFile).catch((unlinkError) => {
          if (!isNotFound(unlinkError)) throw unlinkError;
        });
      }
    }

    throw conflict("无法取得工作区写入锁", { workspace: this.paths.root });
  }

  async release() {
    if (!this.token) return;
    const existing = await this.readExisting();

    if (existing?.token === this.token) {
      await unlink(this.paths.workspaceLockFile).catch((error) => {
        if (!isNotFound(error)) throw error;
      });
    }

    this.token = null;
  }

  private async readExisting(): Promise<WorkspaceLeaseRecord | null> {
    try {
      const parsed = JSON.parse(await readFile(this.paths.workspaceLockFile, "utf8")) as Partial<WorkspaceLeaseRecord>;
      return typeof parsed.token === "string" && typeof parsed.pid === "number" && typeof parsed.startedAt === "string"
        ? parsed as WorkspaceLeaseRecord
        : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      return null;
    }
  }
}

function isAlreadyExists(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
