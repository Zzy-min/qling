import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  fsyncSync,
} from "node:fs";
import path from "node:path";

interface SessionLeaseRecord {
  version: 1;
  sessionId: string;
  token: string;
  pid: number;
  workspaceDir: string;
  acquiredAt: number;
}

function leaseDirectory(stateDir: string, sessionId: string): string {
  const key = createHash("sha256").update(sessionId).digest("hex");
  return path.join(path.resolve(stateDir), "session-leases", `${key}.lock`);
}

function readLeaseRecord(lockDir: string): SessionLeaseRecord | null {
  try {
    const value = JSON.parse(readFileSync(path.join(lockDir, "owner.json"), "utf8")) as SessionLeaseRecord;
    return value?.version === 1 && typeof value.token === "string" && Number.isInteger(value.pid)
      ? value
      : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function writeOwnerRecord(lockDir: string, record: SessionLeaseRecord): void {
  const target = path.join(lockDir, "owner.json");
  const fd = openSync(target, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(record), "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export class SessionLeaseConflictError extends Error {
  readonly code = "SESSION_LEASE_CONFLICT";
  constructor(message: string) {
    super(message);
    this.name = "SessionLeaseConflictError";
  }
}

/** Cross-process single-writer lease for one durable session. */
export class SessionLease {
  readonly token: string;
  readonly sessionId: string;
  private readonly lockDir: string;
  private released = false;

  private constructor(lockDir: string, record: SessionLeaseRecord) {
    this.lockDir = lockDir;
    this.token = record.token;
    this.sessionId = record.sessionId;
  }

  static acquire(options: { stateDir: string; sessionId: string; workspaceDir: string }): SessionLease {
    const lockDir = leaseDirectory(options.stateDir, options.sessionId);
    mkdirSync(path.dirname(lockDir), { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        mkdirSync(lockDir);
        const record: SessionLeaseRecord = {
          version: 1,
          sessionId: options.sessionId,
          token: randomUUID(),
          pid: process.pid,
          workspaceDir: path.resolve(options.workspaceDir),
          acquiredAt: Date.now(),
        };
        try {
          writeOwnerRecord(lockDir, record);
        } catch (error) {
          rmSync(lockDir, { recursive: true, force: true });
          throw error;
        }
        return new SessionLease(lockDir, record);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        const existing = readLeaseRecord(lockDir);
        if (!existing) {
          throw new SessionLeaseConflictError(`会话 ${options.sessionId} 的租约记录损坏；为避免双写已拒绝启动`);
        }
        if (isProcessAlive(existing.pid)) {
          throw new SessionLeaseConflictError(`会话 ${options.sessionId} 已由进程 ${existing.pid} 持有`);
        }
        const stale = `${lockDir}.stale.${Date.now()}.${randomUUID()}`;
        try {
          renameSync(lockDir, stale);
        } catch {
          throw new SessionLeaseConflictError(`会话 ${options.sessionId} 的失效租约无法安全隔离`);
        }
      }
    }
    throw new SessionLeaseConflictError(`无法获取会话 ${options.sessionId} 的单写者租约`);
  }

  assertOwned(): void {
    const current = readLeaseRecord(this.lockDir);
    if (this.released || current?.token !== this.token || current.pid !== process.pid) {
      throw new SessionLeaseConflictError(`会话 ${this.sessionId} 的写入租约已失效`);
    }
  }

  release(): void {
    if (this.released) return;
    const current = readLeaseRecord(this.lockDir);
    if (current?.token === this.token && current.pid === process.pid) {
      rmSync(this.lockDir, { recursive: true, force: true });
    }
    this.released = true;
  }
}

export function isSessionLeaseTokenActive(stateDir: string, sessionId: string, token: string): boolean {
  const record = readLeaseRecord(leaseDirectory(stateDir, sessionId));
  return Boolean(record && record.token === token && isProcessAlive(record.pid));
}

export function assertSessionLeaseToken(stateDir: string, sessionId: string, token: string): void {
  if (!isSessionLeaseTokenActive(stateDir, sessionId, token)) {
    throw new SessionLeaseConflictError(`会话 ${sessionId} 的后台任务写入缺少有效租约`);
  }
}
