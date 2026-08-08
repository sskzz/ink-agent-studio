import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
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
 * 注意：Windows 上该调用对"任何存活进程"都返回成功，不校验进程身份——
 * 后端崩溃后系统可能把同一 PID 分配给无关进程（PID 复用），因此存活检查
 * 必须配合 getProcessStartTime 的创建时间核对（见 acquire）。
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
 * 查询指定 pid 进程的创建时间；非 Windows 或查询失败返回 null。
 * 业务原因：Windows 的 process.kill(pid, 0) 无法区分"锁持有者进程"与"恰好复用了
 * 同一 PID 的无关进程"。通过 PowerShell 读取进程创建时间并与锁记录时间比对，
 * 能可靠识别 PID 复用造成的过期锁假阳性（实验时实际遇到：锁记录为昨天，
 * 该 PID 却是今天新启动的 cmd.exe）。
 */
function getProcessStartTime(pid: number): Promise<Date | null> {
  if (process.platform !== "win32") return Promise.resolve(null);

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).StartTime.ToString('o')`],
      { windowsHide: true, timeout: 3_000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const startTime = Date.parse(String(stdout).trim());
        resolve(Number.isFinite(startTime) ? new Date(startTime) : null);
      }
    );
  });
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
   * 锁文件已存在时区分两种情况：持锁进程存活 → 409 冲突；进程已死或 PID 已被复用 → 删除过期锁重试。
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
        const leaseIsStale = await this.isStaleLease(existing);

        if (leaseIsStale) {
          await unlink(this.paths.workspaceLockFile).catch((unlinkError) => {
            if (!isNotFound(unlinkError)) throw unlinkError;
          });
          continue;
        }

        throw conflict("工作区已被另一个后端进程占用", {
          workspace: this.paths.root,
          pid: existing?.pid,
          startedAt: existing?.startedAt
        });
      }
    }

    throw conflict("无法取得工作区写入锁", { workspace: this.paths.root });
  }

  /**
   * 判断锁记录是否已过期（可安全清除）。
   * 判定顺序：
   * 1. 锁文件无效（格式不合法/不存在）→ 过期；
   * 2. 记录 pid 无存活进程 → 崩溃遗留，过期；
   * 3. Windows 上 pid 存活但进程创建时间晚于锁记录写入时间 → PID 已被系统复用给
   *    无关进程（真实持有者已死），过期；
   * 4. 无法查询创建时间 → 保守按"仍被占用"处理（沿用旧行为）。
   */
  private async isStaleLease(existing: WorkspaceLeaseRecord | null): Promise<boolean> {
    if (!existing) return true;
    if (!isProcessAlive(existing.pid)) return true;

    const lockedAt = Date.parse(existing.startedAt);
    if (Number.isNaN(lockedAt)) return false;

    const processStart = await getProcessStartTime(existing.pid);
    if (processStart === null) return false;

    // 进程创建晚于锁记录 2 秒以上 → PID 复用；容忍 2 秒避免时钟与查询精度造成的抖动。
    return processStart.getTime() > lockedAt + 2_000;
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
