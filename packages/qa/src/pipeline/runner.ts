import { spawn } from "node:child_process";
import type { PipelineReporter, PipelineResult, PipelineStep, StepResult } from "./types.js";

export interface RunPipelineOptions {
  cwd?: string;
  /** `inherit` streams to the parent terminal; `pipe` captures stdout/stderr on each result. */
  stdio?: "inherit" | "pipe";
  reporter?: PipelineReporter;
  now?: () => number;
}

interface StepOutcome {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}

/**
 * Runs steps in order and stops at the first failure unless the step sets
 * `continueOnError`. The failing child's exit code becomes the pipeline exit code.
 */
export async function runPipeline(
  steps: readonly PipelineStep[],
  options: RunPipelineOptions = {}
): Promise<PipelineResult> {
  const stdio = options.stdio ?? "inherit";
  const now = options.now ?? (() => performance.now());
  const results: StepResult[] = [];
  let ok = true;
  let exitCode = 0;
  const total = steps.length;

  for (const [index, step] of steps.entries()) {
    if (step.condition && !(await step.condition())) {
      const skipped: StepResult = {
        name: step.name,
        status: "skipped",
        exitCode: 0,
        durationMs: 0,
        signal: null,
      };
      results.push(skipped);
      options.reporter?.onStepEnd?.(skipped, index, total);
      continue;
    }

    options.reporter?.onStepStart?.(step, index, total);
    const startedAt = now();
    const outcome = await runStep(step, { cwd: options.cwd, stdio });
    const result: StepResult = {
      name: step.name,
      status: outcome.exitCode === 0 ? "passed" : "failed",
      exitCode: outcome.exitCode,
      durationMs: now() - startedAt,
      signal: outcome.signal,
      ...(outcome.stdout !== undefined ? { stdout: outcome.stdout } : {}),
      ...(outcome.stderr !== undefined ? { stderr: outcome.stderr } : {}),
    };
    results.push(result);
    options.reporter?.onStepEnd?.(result, index, total);

    if (result.status === "failed") {
      ok = false;
      if (exitCode === 0) {
        exitCode = result.exitCode === 0 ? 1 : result.exitCode;
      }
      if (!step.continueOnError) {
        return { ok, exitCode, steps: results };
      }
    }
  }

  return { ok, exitCode, steps: results };
}

function runStep(
  step: PipelineStep,
  context: { cwd: string | undefined; stdio: "inherit" | "pipe" }
): Promise<StepOutcome> {
  return new Promise<StepOutcome>((resolve, reject) => {
    const child = spawn(step.command, step.args ? [...step.args] : [], {
      cwd: step.cwd ?? context.cwd,
      env: { ...process.env, ...step.env },
      stdio: context.stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    if (context.stdio === "pipe") {
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({
        exitCode: code ?? (signal ? 1 : 0),
        signal: signal ?? null,
        ...(context.stdio === "pipe" ? { stdout, stderr } : {}),
      });
    });
  });
}
