import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RunLockBusyError } from "../src/errors.js";
import { RunLock } from "../src/pipeline/lock.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "qa-lock-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("RunLock", () => {
  it("acquires and records holder metadata", () => {
    const lockDir = join(tempDir(), "run.lock");
    const lock = new RunLock({ lockDir });

    const holder = lock.tryAcquire("qa ci");

    expect(holder.pid).toBe(process.pid);
    expect(holder.command).toBe("qa ci");
    expect(lock.readHolder()).toEqual(holder);

    lock.release();
    expect(existsSync(lockDir)).toBe(false);
  });

  it("rejects a second acquisition while held and reports the holder", () => {
    const lockDir = join(tempDir(), "run.lock");
    const first = new RunLock({ lockDir });
    const second = new RunLock({ lockDir });
    first.tryAcquire("qa ci");

    let thrown: unknown;
    try {
      second.tryAcquire("qa ci");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RunLockBusyError);
    expect((thrown as RunLockBusyError).holder.pid).toBe(process.pid);
    expect((thrown as RunLockBusyError).message).toContain("pipeline locked by PID");

    first.release();
    const reacquired = second.tryAcquire("qa ci");
    expect(reacquired.pid).toBe(process.pid);
    second.release();
  });

  it("reclaims a lock left by a dead process", () => {
    const lockDir = join(tempDir(), "run.lock");
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, "holder.json"),
      JSON.stringify({ pid: 999_999, command: "qa ci", timestamp: Date.now(), user: "ghost" })
    );

    const lock = new RunLock({ lockDir, isProcessAlive: (pid) => pid !== 999_999 });
    const holder = lock.tryAcquire("qa ci");

    expect(holder.pid).toBe(process.pid);
    expect(lock.readHolder()?.user).not.toBe("ghost");
    lock.release();
  });

  it("reclaims a lock older than staleMs even when the PID is alive", () => {
    const lockDir = join(tempDir(), "run.lock");
    const fixedNow = 1_000_000_000;
    const lock = new RunLock({
      lockDir,
      staleMs: 1000,
      now: () => fixedNow,
      isProcessAlive: () => true,
    });
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, "holder.json"),
      JSON.stringify({ pid: process.pid, command: "qa ci", timestamp: 0, user: "old" })
    );

    const holder = lock.tryAcquire("qa ci");

    expect(holder.timestamp).toBe(fixedNow);
    lock.release();
  });

  it("creates missing parent directories for the lock", () => {
    const lockDir = join(tempDir(), "node_modules", ".cache", "@develoz", "qa", "run.lock");
    const lock = new RunLock({ lockDir });

    const holder = lock.tryAcquire("qa ci");

    expect(holder.pid).toBe(process.pid);
    lock.release();
    expect(existsSync(lockDir)).toBe(false);
  });

  it("treats release as a no-op when the lock is not held", () => {
    const lockDir = join(tempDir(), "run.lock");
    const lock = new RunLock({ lockDir });
    expect(() => lock.release()).not.toThrow();
  });

  it("returns null for a missing or malformed holder file", () => {
    const lockDir = join(tempDir(), "run.lock");
    mkdirSync(lockDir, { recursive: true });
    const lock = new RunLock({ lockDir });

    expect(lock.readHolder()).toBeNull();

    writeFileSync(join(lockDir, "holder.json"), "{ not json");
    expect(lock.readHolder()).toBeNull();
  });
});
