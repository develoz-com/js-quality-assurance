import { existsSync } from "node:fs";
import { join } from "node:path";
import type { QaConfig } from "./config.js";
import type { ResolvedCoverage } from "./coverage.js";
import type { PipelineStep } from "./pipeline/types.js";
import { listStagedFiles, type PackageManagerKind, type ProjectInfo } from "./stacks.js";
import { TOOLS, type ToolCommand, toolCommand } from "./tools.js";

const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"] as const;

export interface BuildContext {
  cwd: string;
  config: QaConfig;
  project: ProjectInfo;
  coverage: ResolvedCoverage;
}

function step(name: string, tool: ToolCommand, args: string[]): PipelineStep {
  return { name, command: tool.command, args: [...tool.argsPrefix, ...args] };
}

export function buildTypecheckStep(ctx: BuildContext): PipelineStep[] {
  const tsc = toolCommand(TOOLS.tsc, ctx.cwd);
  if (!tsc) {
    return [];
  }
  return [step("typecheck", tsc, ["--noEmit"])];
}

export function buildLintSteps(
  ctx: BuildContext,
  options: { staged?: boolean; fix?: boolean } = {}
): PipelineStep[] {
  const linter = ctx.config.linter ?? "biome";

  if (linter === "eslint") {
    const eslint = toolCommand(TOOLS.eslint, ctx.cwd);
    if (!eslint) {
      return [];
    }
    let args: string[];
    if (options.staged) {
      const files = listStagedFiles(ctx.cwd, SOURCE_EXTENSIONS);
      if (files.length === 0) {
        return [];
      }
      args = ["--no-warn-ignored", ...files];
    } else {
      args = ["."];
    }
    if (options.fix) {
      args.push("--fix");
    }
    return [step("lint", eslint, args)];
  }

  const biome = toolCommand(TOOLS.biome, ctx.cwd);
  if (!biome) {
    return [];
  }
  const args = ["check"];
  if (options.staged) {
    args.push("--staged");
  }
  if (options.fix) {
    args.push("--write");
  }
  return [step("lint", biome, args)];
}

export function buildFormatSteps(
  ctx: BuildContext,
  options: { staged?: boolean; write?: boolean } = {}
): PipelineStep[] {
  const formatter = ctx.config.formatter ?? "biome";

  if (formatter === "prettier") {
    const prettier = toolCommand(TOOLS.prettier, ctx.cwd);
    if (!prettier) {
      return [];
    }
    return [step("format", prettier, options.write ? ["--write", "."] : ["--check", "."])];
  }

  const biome = toolCommand(TOOLS.biome, ctx.cwd);
  if (!biome) {
    return [];
  }
  const args = ["format"];
  if (options.staged) {
    args.push("--staged");
  }
  if (options.write) {
    args.push("--write");
  }
  return [step("format", biome, args)];
}

export function buildTestStep(ctx: BuildContext): PipelineStep[] {
  const vitest = toolCommand(TOOLS.vitest, ctx.cwd);
  if (!vitest) {
    return [];
  }
  return [step("test", vitest, ["run"])];
}

export function buildCoverageStep(ctx: BuildContext): PipelineStep[] {
  const vitest = toolCommand(TOOLS.vitest, ctx.cwd);
  if (!vitest) {
    return [];
  }
  const c = ctx.coverage;
  return [
    step("coverage", vitest, [
      "run",
      "--coverage",
      `--coverage.provider=${c.provider}`,
      `--coverage.thresholds.lines=${c.lines}`,
      `--coverage.thresholds.branches=${c.branches}`,
      `--coverage.thresholds.functions=${c.functions}`,
      `--coverage.thresholds.statements=${c.statements}`,
      `--coverage.thresholds.perFile=${c.perFile}`,
      "--coverage.reporter=text",
      "--coverage.reporter=lcov",
    ]),
  ];
}

export function buildDeadcodeStep(ctx: BuildContext): PipelineStep[] {
  const knip = toolCommand(TOOLS.knip, ctx.cwd);
  if (!knip) {
    return [];
  }
  const args = ["--no-progress"];
  if (ctx.config.deadcode?.strict) {
    args.push("--treat-config-hints-as-errors");
  }
  return [step("deadcode", knip, args)];
}

function defaultRulesPath(cwd: string): string | null {
  for (const name of [
    ".dependency-cruiser.cjs",
    ".dependency-cruiser.js",
    ".dependency-cruiser.mjs",
  ]) {
    if (existsSync(join(cwd, name))) {
      return name;
    }
  }
  return null;
}

export function buildBoundariesStep(ctx: BuildContext): PipelineStep[] {
  if (ctx.config.boundaries?.enabled === false) {
    return [];
  }
  const rulesPath = ctx.config.boundaries?.rulesPath ?? defaultRulesPath(ctx.cwd);
  if (!rulesPath) {
    return [];
  }
  if (!existsSync(join(ctx.cwd, rulesPath))) {
    return [];
  }
  const depcruise = toolCommand(TOOLS.depcruise, ctx.cwd);
  if (!depcruise) {
    return [];
  }
  return [step("boundaries", depcruise, ["--config", rulesPath, "--output-type", "err", "."])];
}

export function buildDuplicationStep(ctx: BuildContext): PipelineStep[] {
  const jscpd = toolCommand(TOOLS.jscpd, ctx.cwd);
  if (!jscpd) {
    return [];
  }
  const config = ctx.config.duplication;
  const args = ["--threshold", String(config?.threshold ?? 0), "--reporters", "console"];
  if (config?.minTokens !== undefined) {
    args.push("--min-tokens", String(config.minTokens));
  }
  if (config?.ignore && config.ignore.length > 0) {
    args.push("--ignore", config.ignore.join(","));
  }
  return [step("duplication", jscpd, args)];
}

export function buildSmellsStep(ctx: BuildContext): PipelineStep[] {
  const tool = ctx.config.smells?.tool ?? "biome";

  if (tool === "eslint") {
    const eslint = toolCommand(TOOLS.eslint, ctx.cwd);
    if (!eslint) {
      return [];
    }
    return [step("smells", eslint, ["."])];
  }

  const biome = toolCommand(TOOLS.biome, ctx.cwd);
  if (!biome) {
    return [];
  }
  // Complexity only: the "suspicious" group includes noConsole, which a CLI
  // legitimately uses. Targets source, never test files.
  const target = existsSync(join(ctx.cwd, "src")) ? "src" : ".";
  return [step("smells", biome, ["lint", "--only=complexity", "--error-on-warnings", target])];
}

function auditArgs(pm: PackageManagerKind, level: string): string[] {
  // Yarn classic returns a severity bitmask from `audit` and does not accept
  // --audit-level, so it is run bare and interpreted by the package manager.
  return pm === "yarn" ? ["audit"] : ["audit", "--audit-level", level];
}

export function buildAuditStep(ctx: BuildContext): PipelineStep[] {
  if (!ctx.project.hasPackageJson) {
    return [];
  }
  const level = ctx.config.audit?.level ?? "high";
  return [
    {
      name: "audit",
      command: ctx.project.packageManager,
      args: auditArgs(ctx.project.packageManager, level),
      // Run where the lockfile lives, which in a monorepo is the workspace root.
      cwd: ctx.project.root,
    },
  ];
}

export function buildCiSteps(ctx: BuildContext): PipelineStep[] {
  return [
    ...buildAuditStep(ctx),
    ...buildTypecheckStep(ctx),
    ...buildLintSteps(ctx),
    ...buildBoundariesStep(ctx),
    ...buildDeadcodeStep(ctx),
    ...buildDuplicationStep(ctx),
    ...buildSmellsStep(ctx),
    ...buildCoverageStep(ctx),
  ];
}
