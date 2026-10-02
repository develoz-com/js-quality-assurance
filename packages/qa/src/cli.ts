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
  buildPreCommitSteps,
  buildSmellsStep,
  buildStylesStep,
  buildTestStep,
  buildTypecheckStep,
  hasStagedTypeScript,
  reportDir,
} from "./commands.js";
import type { QaConfig } from "./config.js";
import { resolveCoverage } from "./coverage.js";
import { RunLockBusyError } from "./errors.js";
import { HooksConflictError, installHooks, NotAGitRepositoryError } from "./generators/hooks.js";
import { RunLock } from "./pipeline/lock.js";
import { runPipeline } from "./pipeline/runner.js";
import type { PipelineReporter, PipelineStep } from "./pipeline/types.js";
import { buildReport } from "./reporters/report.js";
import { detectProject, type PackageManagerKind } from "./stacks.js";

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

function runHooks(
  cwd: string,
  action: string | undefined,
  packageManager: PackageManagerKind
): number {
  if (action !== "install") {
    console.error("qa: usage: qa hooks install");
    return 1;
  }
  try {
    const result = installHooks(cwd, packageManager);
    console.log(
      `qa: ${result.hooksPath} hook ${result.changed ? "written" : "already up to date"} (${result.hookPath})`
    );
    return 0;
  } catch (error) {
    if (error instanceof HooksConflictError || error instanceof NotAGitRepositoryError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
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
  smells       Flag complex or suspicious code (project Biome lint rules)
  styles       Lint CSS/Tailwind/SCSS with stylelint (auto-enabled)
  audit        Audit dependencies for known vulnerabilities
  report       Merge gate artifacts (SARIF + dependency-cruiser) into qa.sarif
  hooks install  Install the tracked .githooks/pre-commit hook
  pre-commit   Run the staged pre-commit gates (used by the hook)
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
    case "styles":
      return execute(cwd, "styles", buildStylesStep(ctx), options);
    case "audit":
      return execute(cwd, "audit", buildAuditStep(ctx), options);
    case "hooks":
      return runHooks(cwd, rest[0], ctx.project.packageManager);
    case "report": {
      const directory = reportDir(ctx);
      const result = buildReport(directory);
      console.log(
        `qa: wrote ${result.outputPath} (${result.resultCount} results from ${result.inputs.length} artifact(s))`
      );
      if (result.inputs.length === 0) {
        console.log("qa: no artifacts found; run a gate with reporting enabled first.");
      }
      return 0;
    }
    case "pre-commit":
      return execute(
        cwd,
        "pre-commit",
        buildPreCommitSteps(ctx, { stagedTypeScript: hasStagedTypeScript(cwd) }),
        options
      );
    default:
      console.error(`qa: unknown command '${command}'. Run 'qa --help'.`);
      return 1;
  }
}
