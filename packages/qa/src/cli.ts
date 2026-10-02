import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { QaConfig } from "./config.js";
import { RunLockBusyError } from "./errors.js";
import { RunLock } from "./pipeline/lock.js";
import { runPipeline } from "./pipeline/runner.js";
import type { PipelineReporter, PipelineStep } from "./pipeline/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
  version: string;
};

/**
 * ESM config only for now. TypeScript config loading (`qa.config.ts`) arrives with
 * the adapter milestone; it needs a TS loader the core does not depend on.
 */
const CONFIG_CANDIDATES = ["qa.config.mjs", "qa.config.js"] as const;

const reporter: PipelineReporter = {
  onStepStart: (step: PipelineStep, index: number, total: number) => {
    console.log(`\n[${index + 1}/${total}] ${step.name}`);
  },
  onStepEnd: (result) => {
    const icon = result.status === "passed" ? "✓" : result.status === "skipped" ? "–" : "✗";
    console.log(`${icon} ${result.name} — ${result.status} (${Math.round(result.durationMs)}ms)`);
  },
};

export function defaultLockDir(cwd: string): string {
  return join(cwd, "node_modules", ".cache", "@develoz", "qa", "run.lock");
}

export async function loadConfig(cwd: string): Promise<QaConfig> {
  for (const name of CONFIG_CANDIDATES) {
    const path = join(cwd, name);
    if (!existsSync(path)) {
      continue;
    }
    const module = (await import(pathToFileURL(path).href)) as { default?: QaConfig };
    return module.default ?? {};
  }
  return {};
}

export function collectSteps(config: QaConfig): PipelineStep[] {
  return [...(config.pipeline?.preSteps ?? []), ...(config.pipeline?.postSteps ?? [])];
}

export async function runCi(cwd: string, args: readonly string[] = []): Promise<number> {
  const config = await loadConfig(cwd);
  const steps = collectSteps(config);

  if (steps.length === 0) {
    console.log("qa: no pipeline steps configured. Stack adapters land in a later milestone.");
    return 0;
  }

  const lock = new RunLock({ lockDir: defaultLockDir(cwd) });
  try {
    lock.tryAcquire(["qa ci", ...args].join(" ").trim());
  } catch (error) {
    if (error instanceof RunLockBusyError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  try {
    const result = await runPipeline(steps, { cwd, stdio: "inherit", reporter });
    console.log(result.ok ? "\n✓ qa ci passed" : "\n✗ qa ci failed");
    return result.exitCode;
  } finally {
    lock.release();
  }
}

function printHelp(): void {
  console.log(`@develoz/qa ${packageJson.version}

Usage: qa <command>

Commands:
  ci        Run the configured quality pipeline
  --help    Show this help
  --version Print the version
`);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;
  const cwd = process.cwd();

  switch (command) {
    case undefined:
    case "--help":
    case "-h":
      printHelp();
      return 0;
    case "--version":
    case "-v":
      console.log(packageJson.version);
      return 0;
    case "ci":
      return runCi(cwd, rest);
    default:
      console.error(`qa: unknown command '${command}'. Run 'qa --help'.`);
      return 1;
  }
}
