import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const worker = join(packageRoot, "test", "fixtures", "lock-worker.mjs");

beforeAll(() => {
  // The worker is a separate Node process, so it consumes the compiled output.
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], {
    cwd: packageRoot,
    stdio: "pipe",
  });
  if (!existsSync(join(packageRoot, "dist", "pipeline", "lock.js"))) {
    throw new Error("expected compiled lock at dist/pipeline/lock.js");
  }
}, 120_000);

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
