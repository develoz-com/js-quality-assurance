import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// The worker is a separate Node process that consumes the compiled output, which
// test/global-setup.ts builds once before any file runs.
const worker = join(packageRoot, "test", "fixtures", "lock-worker.mjs");

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "qa-conc-"));
  dirs.push(dir);
  return dir;
}

function runWorker(lockDir: string, holdMs: number): Promise<number> {
  return new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [worker, lockDir, String(holdMs)], {
      stdio: "ignore",
    });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("RunLock under real process concurrency", () => {
  it("lets exactly one of several simultaneous processes hold the lock", async () => {
    const lockDir = join(tempDir(), "run.lock");

    const codes = await Promise.all([
      runWorker(lockDir, 500),
      runWorker(lockDir, 500),
      runWorker(lockDir, 500),
      runWorker(lockDir, 500),
      runWorker(lockDir, 500),
    ]);

    expect(codes.filter((code) => code === 0)).toHaveLength(1);
    expect(codes.filter((code) => code === 2)).toHaveLength(4);
  }, 60_000);
});
