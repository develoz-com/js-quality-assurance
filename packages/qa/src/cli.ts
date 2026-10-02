import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type BuildContext,
  buildAuditStep,
  buildBoundariesStep,
  buildCiSteps,
  buildCoverageStep,
  buildDeadcodeStep,
  buildDuplicationStep,
  buildFormatSteps,
  buildLintSteps,
  buildSmellsStep,
  buildTestStep,
  buildTypecheckStep,
} from "./commands.js";
import type { QaConfig } from "./config.js";
import { resolveCoverage } from "./coverage.js";
import { RunLockBusyError } from "./errors.js";
import { RunLock } from "./pipeline/lock.js";
import { runPipeline } from "./pipeline/runner.js";
import type { PipelineReporter, PipelineStep } from "./pipeline/types.js";
import { detectProject } from "./stacks.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
  version: string;
};

/**
 * ESM config only for now. TypeScript config loading (`qa.config.ts`) needs a TS
 * loader the core does not depend on.
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

export function buildContext(cwd: string, config: QaConfig): BuildContext {
  return {
    cwd,
    config,
    project: detectProject(cwd),
    coverage: resolveCoverage({ config: config.coverage }),
  };
}

async function execute(
  cwd: string,
  name: string,
  steps: PipelineStep[],
  options: { lock?: boolean; args?: readonly string[] } = {}
): Promise<number> {
  if (steps.length === 0) {
    console.log(`qa: ${name} has nothing to run (tool unavailable or not applicable).`);
    return 0;
  }

  const run = async (): Promise<number> => {
    const result = await runPipeline(steps, { cwd, stdio: "inherit", reporter });
    console.log(result.ok ? `\n✓ qa ${name} passed` : `\n✗ qa ${name} failed`);
    return result.exitCode;
  };

  if (!options.lock) {
    return run();
  }

  const lock = new RunLock({ lockDir: defaultLockDir(cwd) });
  try {
    lock.tryAcquire([`qa ${name}`, ...(options.args ?? [])].join(" ").trim());
  } catch (error) {
    if (error instanceof RunLockBusyError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }

  try {
    return await run();
  } finally {
    lock.release();
  }
}

function ciSteps(ctx: BuildContext): PipelineStep[] {
  return [
    ...(ctx.config.pipeline?.preSteps ?? []),
    ...buildCiSteps(ctx),
    ...(ctx.config.pipeline?.postSteps ?? []),
  ];
}

function printHelp(): void {
  console.log(`@develoz/qa ${packageJson.version}

Usage: qa <command>

Commands:
  ci           Run the full pipeline (audit, typecheck, lint, boundaries, deadcode, duplication, smells, coverage)
  lint         Lint with Biome (default) or ESLint        [--staged] [--fix]
  format       Format with Biome (default) or Prettier    [--staged] [--write]
  typecheck    Type-check with tsc --noEmit
  test         Run the test suite once (no coverage)
  coverage     Run the test suite once and enforce coverage thresholds
  deadcode     Find unused files, exports and dependencies (knip)
  boundaries   Enforce architecture rules (dependency-cruiser)
  duplication  Detect copy/paste (jscpd)
  smells       Flag complex code (Biome complexity/suspicious rules)
  audit        Audit dependencies for known vulnerabilities
  --help       Show this help
  --version    Print the version
`);
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const [command, ...rest] = argv;
  const cwd = process.cwd();

  if (command === undefined || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  if (command === "--version" || command === "-v") {
    console.log(packageJson.version);
    return 0;
  }

  const config = await loadConfig(cwd);
  const ctx = buildContext(cwd, config);
  const staged = rest.includes("--staged");
  const fix = rest.includes("--fix");
  const write = rest.includes("--write");
  const options = { args: rest };

  switch (command) {
    case "ci":
      return execute(cwd, "ci", ciSteps(ctx), { ...options, lock: true });
    case "lint":
      return execute(cwd, "lint", buildLintSteps(ctx, { staged, fix }), options);
    case "format":
      return execute(cwd, "format", buildFormatSteps(ctx, { staged, write }), options);
    case "typecheck":
      return execute(cwd, "typecheck", buildTypecheckStep(ctx), options);
    case "test":
      return execute(cwd, "test", buildTestStep(ctx), options);
    case "coverage":
      return execute(cwd, "coverage", buildCoverageStep(ctx), options);
    case "deadcode":
      return execute(cwd, "deadcode", buildDeadcodeStep(ctx), options);
    case "boundaries":
      return execute(cwd, "boundaries", buildBoundariesStep(ctx), options);
    case "duplication":
      return execute(cwd, "duplication", buildDuplicationStep(ctx), options);
    case "smells":
      return execute(cwd, "smells", buildSmellsStep(ctx), options);
    case "audit":
      return execute(cwd, "audit", buildAuditStep(ctx), options);
    default:
      console.error(`qa: unknown command '${command}'. Run 'qa --help'.`);
      return 1;
  }
}
