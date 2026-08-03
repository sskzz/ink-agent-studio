import { randomUUID } from "node:crypto";
import { open, readFile, unlink } from "node:fs/promises";
import { conflict } from "../utils/errors.js";
import type { WorkspacePaths } from "../modules/workspace/workspacePaths.js";

/**
 * 工作区写锁（租约）。
 * 用原子创建锁文件（O_EXCL）保证同一工作区同时只允许一个后端进程写入；
 * 锁文件里记录 token + pid，用于识别并回收崩溃进程遗留的过期锁。
 */

/** 锁文件内容：token 用于确认锁归属，pid 用于探测进程是否存活。 */
interface WorkspaceLeaseRecord {
  token: string;
  pid: number;
  startedAt: string;
}

/**
 * 探测 pid 进程是否存活。
 * process.kill(pid, 0) 只发送空信号用于存在性检查，不真正终止进程。
 */
function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false;

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 工作区租约：acquire 加锁，release 释放。
 */
export class WorkspaceLease {
  /** 本进程持有的 token；为空表示未持有锁。 */
  private token: string | null = null;

  constructor(private readonly paths: WorkspacePaths) {}

  /**
   * 获取工作区写锁。
   * 锁文件已存在时区分两种情况：持锁进程存活 → 409 冲突；进程已死 → 删除过期锁重试。
   * 失败重试只做一轮（两次尝试），避免两个进程同时清锁造成互相抢占。
   */
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

  /**
   * 释放工作区写锁。
   * 只有锁文件仍由本进程持有（token 匹配）时才删除，防止误删其他进程刚获取的锁。
   */
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

  /**
   * 读取当前锁文件内容。
   * 文件不存在或内容格式不合法一律返回 null（视为无有效锁），让 acquire 走重试路径。
   */
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

/** 判断错误是否为“文件已存在”（原子创建锁文件时的竞争信号）。 */
function isAlreadyExists(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

/** 判断错误是否为“文件不存在”（删除过期锁时可容忍的失败）。 */
function isNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
