import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RunLockBusyError } from "../errors.js";

export interface LockHolder {
  pid: number;
  command: string;
  timestamp: number;
  user: string;
}

export interface RunLockOptions {
  /** Directory used as the lock. Its atomic creation is the mutual exclusion. */
  lockDir: string;
  /** A held lock older than this is reclaimed even if the PID is still alive. */
  staleMs?: number;
  /** Injectable for tests. Defaults to a `kill(pid, 0)` probe. */
  isProcessAlive?: (pid: number) => boolean;
  /** Injectable clock for tests. */
  now?: () => number;
}

const DEFAULT_STALE_MS = 30 * 60 * 1000;

/**
 * Cross-process run lock. Uses atomic `mkdir` for acquisition so it works on any
 * platform without native addons, and stores holder metadata for diagnostics.
 */
export class RunLock {
  readonly lockDir: string;
  private readonly staleMs: number;
  private readonly isProcessAlive: (pid: number) => boolean;
  private readonly now: () => number;
  private held = false;
  private acquiredAt: number | null = null;

  constructor(options: RunLockOptions) {
    this.lockDir = options.lockDir;
    this.staleMs = options.staleMs ?? DEFAULT_STALE_MS;
    this.isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
    this.now = options.now ?? Date.now;
  }

  private get holderFile(): string {
    return join(this.lockDir, "holder.json");
  }

  tryAcquire(command: string): LockHolder {
    const acquired = this.tryCreate(command);
    if (acquired) {
      return acquired;
    }

    const holder = this.readHolder();
    if (holder && this.isStale(holder)) {
      this.reclaim();
      const retry = this.tryCreate(command);
      if (retry) {
        return retry;
      }
      throw new RunLockBusyError(this.readHolder() ?? holder);
    }

    throw new RunLockBusyError(
      holder ?? { pid: -1, command: "unknown", timestamp: this.now(), user: "unknown" }
    );
  }

  readHolder(): LockHolder | null {
    if (!existsSync(this.holderFile)) {
      return null;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.holderFile, "utf8")) as Partial<LockHolder>;
      if (
        typeof parsed.pid !== "number" ||
        typeof parsed.command !== "string" ||
        typeof parsed.timestamp !== "number"
      ) {
        return null;
      }
      return {
        pid: parsed.pid,
        command: parsed.command,
        timestamp: parsed.timestamp,
        user: typeof parsed.user === "string" ? parsed.user : "unknown",
      };
    } catch {
      return null;
    }
  }

  release(): void {
    if (!this.held) {
      return;
    }
    const holder = this.readHolder();
    // Only remove a lock this process still owns. A peer may have reclaimed the
    // lock after a stale timeout; deleting it then would tear down their run.
    if (holder && (holder.pid !== process.pid || holder.timestamp !== this.acquiredAt)) {
      this.held = false;
      this.acquiredAt = null;
      return;
    }
    rmSync(this.lockDir, { recursive: true, force: true });
    this.held = false;
    this.acquiredAt = null;
  }

  private tryCreate(command: string): LockHolder | null {
    // The lock dir itself is created non-recursively so that creation is the
    // atomic test-and-set. Its parents must already exist.
    mkdirSync(dirname(this.lockDir), { recursive: true });
    try {
      mkdirSync(this.lockDir, { recursive: false });
    } catch (error) {
      if (isErrno(error, "EEXIST")) {
        return null;
      }
      throw error;
    }

    const holder: LockHolder = {
      pid: process.pid,
      command,
      timestamp: this.now(),
      user: currentUser(),
    };
    writeFileSync(this.holderFile, `${JSON.stringify(holder, null, 2)}\n`, "utf8");
    this.held = true;
    this.acquiredAt = holder.timestamp;
    return holder;
  }

  private isStale(holder: LockHolder): boolean {
    if (!this.isProcessAlive(holder.pid)) {
      return true;
    }
    return this.now() - holder.timestamp > this.staleMs;
  }

  private reclaim(): void {
    // Rename first: only one process can win the rename, so a peer that also saw
    // the stale holder cannot delete a lock someone else just created.
    const tombstone = `${this.lockDir}.stale-${process.pid}-${randomUUID()}`;
    try {
      renameSync(this.lockDir, tombstone);
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        return;
      }
      throw error;
    }
    rmSync(tombstone, { recursive: true, force: true });
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function defaultIsProcessAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrno(error, "EPERM");
  }
}

function currentUser(): string {
  return process.env.USER ?? process.env.USERNAME ?? "unknown";
}
