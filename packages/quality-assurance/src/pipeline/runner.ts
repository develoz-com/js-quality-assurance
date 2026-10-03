import { spawn } from "node:child_process";
import { constants } from "node:os";
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

type Gate = { kind: "run" } | { kind: "skip" } | { kind: "failure"; message: string };

/**
 * Runs steps in order and stops at the first failure unless the step sets
 * `continueOnError`. The first failure's child exit code becomes the pipeline
 * exit code.
 */
export async function runPipeline(
  steps: readonly PipelineStep[],
  options: RunPipelineOptions = {}
): Promise<PipelineResult> {
  const context: StepContext = {
    cwd: options.cwd,
    stdio: options.stdio ?? "inherit",
    now: options.now ?? (() => performance.now()),
    reporter: options.reporter,
    total: steps.length,
  };
  const results: StepResult[] = [];
  let exitCode = 0;

  for (const [index, step] of steps.entries()) {
    const { result, stop } = await executeStep(step, index, context);
    results.push(result);
    if (result.status === "failed") {
      exitCode = exitCode === 0 ? normalizeExitCode(result.exitCode) : exitCode;
      if (stop) {
        break;
      }
    }
  }

  return { ok: exitCode === 0, exitCode, steps: results };
}

interface StepContext {
  cwd: string | undefined;
  stdio: "inherit" | "pipe";
  now: () => number;
  reporter: PipelineReporter | undefined;
  total: number;
}

interface StepExecution {
  result: StepResult;
  /** Whether the pipeline should stop after this step (fail-fast). */
  stop: boolean;
}

async function executeStep(
  step: PipelineStep,
  index: number,
  context: StepContext
): Promise<StepExecution> {
  const gate = await evaluateGate(step);

  if (gate.kind === "failure") {
    const result = failedResult(step.name, gate.message);
    context.reporter?.onStepEnd?.(result, index, context.total);
    return { result, stop: !step.continueOnError };
  }

  if (gate.kind === "skip") {
    const result = skippedResult(step.name);
    context.reporter?.onStepEnd?.(result, index, context.total);
    return { result, stop: false };
  }

  context.reporter?.onStepStart?.(step, index, context.total);
  const startedAt = context.now();
  const outcome = await runStep(step, { cwd: context.cwd, stdio: context.stdio });
  const result = outcomeToResult(step.name, outcome, context.now() - startedAt);
  context.reporter?.onStepEnd?.(result, index, context.total);
  return { result, stop: result.status === "failed" && !step.continueOnError };
}

async function evaluateGate(step: PipelineStep): Promise<Gate> {
  if (!step.condition) {
    return { kind: "run" };
  }
  try {
    return (await step.condition()) ? { kind: "run" } : { kind: "skip" };
  } catch (error) {
    return { kind: "failure", message: error instanceof Error ? error.message : String(error) };
  }
}

function skippedResult(name: string): StepResult {
  return { name, status: "skipped", exitCode: 0, durationMs: 0, signal: null };
}

function failedResult(name: string, message: string): StepResult {
  return { name, status: "failed", exitCode: 1, durationMs: 0, signal: null, stderr: message };
}

function outcomeToResult(name: string, outcome: StepOutcome, durationMs: number): StepResult {
  return {
    name,
    status: outcome.exitCode === 0 ? "passed" : "failed",
    exitCode: outcome.exitCode,
    durationMs,
    signal: outcome.signal,
    ...(outcome.stdout !== undefined ? { stdout: outcome.stdout } : {}),
    ...(outcome.stderr !== undefined ? { stderr: outcome.stderr } : {}),
  };
}

function normalizeExitCode(exitCode: number): number {
  return exitCode === 0 ? 1 : exitCode;
}

function runStep(
  step: PipelineStep,
  context: { cwd: string | undefined; stdio: "inherit" | "pipe" }
): Promise<StepOutcome> {
  return new Promise<StepOutcome>((resolve) => {
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

    child.on("error", (error) => {
      if (context.stdio === "pipe") {
        resolve({ exitCode: 127, signal: null, stdout, stderr: `${stderr}${error.message}` });
      } else {
        process.stderr.write(`${error.message}\n`);
        resolve({ exitCode: 127, signal: null });
      }
    });

    child.on("close", (code, signal) => {
      resolve({
        exitCode: code ?? exitCodeForSignal(signal),
        signal: signal ?? null,
        ...(context.stdio === "pipe" ? { stdout, stderr } : {}),
      });
    });
  });
}

function exitCodeForSignal(signal: NodeJS.Signals | null): number {
  if (!signal) {
    return 0;
  }
  const number = constants.signals[signal];
  return typeof number === "number" ? 128 + number : 1;
}
