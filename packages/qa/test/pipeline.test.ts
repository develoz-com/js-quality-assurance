import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runPipeline } from "../src/pipeline/runner.js";
import type { PipelineStep } from "../src/pipeline/types.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "qa-pipe-"));
  dirs.push(dir);
  return dir;
}

function readLog(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function appendStep(name: string, logPath: string, value: string): PipelineStep {
  return {
    name,
    command: process.execPath,
    args: [
      "-e",
      `require('node:fs').appendFileSync(process.env.QA_TEST_LOG, ${JSON.stringify(value)})`,
    ],
    env: { QA_TEST_LOG: logPath },
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runPipeline", () => {
  it("runs steps sequentially in order", async () => {
    const log = join(tempDir(), "order.log");
    const result = await runPipeline(
      [appendStep("one", log, "1"), appendStep("two", log, "2"), appendStep("three", log, "3")],
      { stdio: "pipe" }
    );

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.steps.map((step) => step.status)).toEqual(["passed", "passed", "passed"]);
    expect(readLog(log)).toBe("123");
  });

  it("stops at the first failure and propagates the child exit code", async () => {
    const log = join(tempDir(), "fail.log");
    const result = await runPipeline(
      [
        appendStep("one", log, "1"),
        { name: "boom", command: process.execPath, args: ["-e", "process.exit(3)"] },
        appendStep("three", log, "3"),
      ],
      { stdio: "pipe" }
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.steps.map((step) => step.name)).toEqual(["one", "boom"]);
    expect(readLog(log)).toBe("1");
  });

  it("continues past a failure when continueOnError is set", async () => {
    const log = join(tempDir(), "continue.log");
    const result = await runPipeline(
      [
        appendStep("one", log, "1"),
        {
          name: "boom",
          command: process.execPath,
          args: ["-e", "process.exit(2)"],
          continueOnError: true,
        },
        appendStep("three", log, "3"),
      ],
      { stdio: "pipe" }
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.steps.map((step) => step.name)).toEqual(["one", "boom", "three"]);
    expect(result.steps[2]?.status).toBe("passed");
    expect(readLog(log)).toBe("13");
  });

  it("skips steps whose condition is falsy", async () => {
    const log = join(tempDir(), "skip.log");
    const result = await runPipeline(
      [
        appendStep("one", log, "1"),
        { ...appendStep("two", log, "2"), condition: () => false },
        appendStep("three", log, "3"),
      ],
      { stdio: "pipe" }
    );

    expect(result.steps.map((step) => step.status)).toEqual(["passed", "skipped", "passed"]);
    expect(readLog(log)).toBe("13");
  });

  it("captures stdout and stderr when piped", async () => {
    const result = await runPipeline(
      [
        {
          name: "echo",
          command: process.execPath,
          args: ["-e", "console.log('out'); console.error('err')"],
        },
      ],
      { stdio: "pipe" }
    );

    expect(result.steps[0]?.stdout).toContain("out");
    expect(result.steps[0]?.stderr).toContain("err");
  });

  it("reports step lifecycle to a reporter", async () => {
    const starts: string[] = [];
    const ends: string[] = [];
    await runPipeline([appendStep("alpha", join(tempDir(), "x.log"), "1")], {
      stdio: "pipe",
      reporter: {
        onStepStart: (step) => starts.push(step.name),
        onStepEnd: (result) => ends.push(`${result.name}:${result.status}`),
      },
    });

    expect(starts).toEqual(["alpha"]);
    expect(ends).toEqual(["alpha:passed"]);
  });

  it("records a missing command as a failed step instead of crashing", async () => {
    const result = await runPipeline(
      [{ name: "missing", command: "definitely-not-a-real-binary-qa", args: [] }],
      { stdio: "pipe" }
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.steps[0]?.status).toBe("failed");
    expect(result.steps[0]?.stderr).toMatch(/ENOENT/);
  });

  it("records a throwing condition as a failed step", async () => {
    const result = await runPipeline(
      [
        {
          name: "cond",
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
          condition: () => {
            throw new Error("condition blew up");
          },
        },
      ],
      { stdio: "pipe" }
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.steps[0]?.status).toBe("failed");
    expect(result.steps[0]?.stderr).toContain("condition blew up");
  });

  it("maps a signal-killed step to 128 + signal", async () => {
    const result = await runPipeline(
      [
        {
          name: "killed",
          command: process.execPath,
          args: ["-e", "process.kill(process.pid, 'SIGTERM')"],
        },
      ],
      { stdio: "pipe" }
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(143);
    expect(result.steps[0]?.signal).toBe("SIGTERM");
  });
});
