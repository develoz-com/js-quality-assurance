import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { QaConfig, TestRunnerKind } from "./config.js";
import type { ResolvedCoverage } from "./coverage.js";
import type { PipelineStep } from "./pipeline/types.js";
import { DEFAULT_REPORT_DIR } from "./reporters/report.js";
import { listStagedFiles, type PackageManagerKind, type ProjectInfo } from "./stacks.js";
import { resolvePackageFile, selfCliPath, TOOLS, type ToolCommand, toolCommand } from "./tools.js";

const SOURCE_EXTENSIONS = ["ts", "tsx", "js", "jsx", "mjs", "cjs"] as const;
const BIOME_CONFIG_FILES = ["biome.json", "biome.jsonc", ".biome.json"] as const;

export interface BuildContext {
  cwd: string;
  config: QaConfig;
  project: ProjectInfo;
  coverage: ResolvedCoverage;
}

function step(name: string, tool: ToolCommand, args: string[]): PipelineStep {
  return { name, command: tool.command, args: [...tool.argsPrefix, ...args] };
}

function hasProjectBiomeConfig(ctx: BuildContext): boolean {
  return [ctx.cwd, ctx.project.root].some((dir) =>
    BIOME_CONFIG_FILES.some((name) => existsSync(join(dir, name)))
  );
}

/**
 * When the project has no Biome config of its own, point Biome at the preset
 * shipped with this package. Biome resolves `vcs`/`files` relative to the config
 * file, so the shipped preset deliberately contains only formatter and linter
 * rules.
 */
function biomeConfigArgs(ctx: BuildContext): string[] {
  if (hasProjectBiomeConfig(ctx)) {
    return [];
  }
  const configPath = resolvePackageFile(
    "@develoz/quality-assurance-config",
    "biome/biome.base.json",
    ctx.cwd
  );
  return configPath ? [`--config-path=${configPath}`] : [];
}

export function reportEnabled(ctx: BuildContext): boolean {
  if (ctx.config.report?.enabled !== undefined) {
    return ctx.config.report.enabled;
  }
  return Boolean(process.env.CI) || process.env.GITHUB_ACTIONS === "true";
}

/** Report directory, created on demand so tools can write artifacts into it. */
export function reportDir(ctx: BuildContext): string {
  const dir = join(ctx.cwd, ctx.config.report?.directory ?? DEFAULT_REPORT_DIR);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function biomeSarifArgs(ctx: BuildContext, name: string): string[] {
  if (!reportEnabled(ctx)) {
    return [];
  }
  return [
    "--reporter=default",
    "--reporter=sarif",
    `--reporter-file=${join(reportDir(ctx), name)}`,
  ];
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
  const args = ["check", ...biomeConfigArgs(ctx), ...biomeSarifArgs(ctx, "biome.sarif")];
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
    if (options.staged) {
      const files = listStagedFiles(ctx.cwd, SOURCE_EXTENSIONS);
      if (files.length === 0) {
        return [];
      }
      return [step("format", prettier, [...(options.write ? ["--write"] : ["--check"]), ...files])];
    }
    return [step("format", prettier, options.write ? ["--write", "."] : ["--check", "."])];
  }

  const biome = toolCommand(TOOLS.biome, ctx.cwd);
  if (!biome) {
    return [];
  }
  const args = ["format", ...biomeConfigArgs(ctx)];
  if (options.staged) {
    args.push("--staged");
  }
  if (options.write) {
    args.push("--write");
  }
  return [step("format", biome, args)];
}

function testRunner(ctx: BuildContext): TestRunnerKind {
  return ctx.config.test?.runner ?? ctx.project.testRunner;
}

// lcov only lists files the tests actually loaded, so build output is never
// excluded by default: a project whose tests run against its built bundle would
// otherwise have its main logic silently dropped from the gate.
const DEFAULT_COVERAGE_EXCLUDE = [
  "test/",
  "tests/",
  "__tests__/",
  ".test.",
  ".spec.",
  "coverage/",
  "node_modules/",
] as const;

function bunStep(name: string, args: string[]): PipelineStep {
  return { name, command: "bun", args };
}

export function coverageExclude(ctx: BuildContext): readonly string[] {
  return ctx.config.coverage?.exclude ?? DEFAULT_COVERAGE_EXCLUDE;
}

export function buildTestStep(ctx: BuildContext): PipelineStep[] {
  if (testRunner(ctx) === "bun") {
    return [bunStep("test", ["test"])];
  }
  const vitest = toolCommand(TOOLS.vitest, ctx.cwd);
  if (!vitest) {
    return [];
  }
  return [step("test", vitest, ["run"])];
}

/**
 * Bun has no branch coverage and its own threshold enforcement is inconsistent
 * across versions, so bun runs write lcov and a follow-up step enforces the
 * thresholds uniformly. Test files are excluded from the measured set.
 */
function buildBunCoverageSteps(ctx: BuildContext): PipelineStep[] {
  const dir = join(ctx.cwd, "coverage");
  const run = bunStep("coverage", [
    "test",
    "--coverage",
    "--coverage-reporter=lcov",
    `--coverage-dir=${dir}`,
  ]);
  const check: PipelineStep = {
    name: "coverage:check",
    command: process.execPath,
    args: [selfCliPath(), "coverage:check", join(dir, "lcov.info")],
    cwd: ctx.cwd,
  };
  return [run, check];
}

export function buildCoverageStep(ctx: BuildContext): PipelineStep[] {
  if (testRunner(ctx) === "bun") {
    return buildBunCoverageSteps(ctx);
  }
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
      ...(reportEnabled(ctx)
        ? [
            "--reporter=default",
            "--reporter=junit",
            `--outputFile.junit=${join(reportDir(ctx), "junit.xml")}`,
          ]
        : []),
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
  const gate = step("boundaries", depcruise, ["--config", rulesPath, "--output-type", "err", "."]);
  if (!reportEnabled(ctx)) {
    return [gate];
  }
  // JSON output does not fail on violations (verified), so it is artifact-only
  // and runs before the gating step.
  const report: PipelineStep = {
    name: "boundaries:report",
    command: depcruise.command,
    args: [
      ...depcruise.argsPrefix,
      "--config",
      rulesPath,
      "--output-type",
      "json",
      "--output-to",
      join(reportDir(ctx), "dependency-cruiser.json"),
      ".",
    ],
  };
  return [report, gate];
}

const DUPLICATION_FORMATS = ["javascript", "typescript", "jsx", "tsx"] as const;

function duplicationPaths(ctx: BuildContext): string[] {
  const configured = ctx.config.duplication?.paths;
  if (configured && configured.length > 0) {
    return [...configured];
  }
  return [existsSync(join(ctx.cwd, "src")) ? "src" : "."];
}

export function buildDuplicationStep(ctx: BuildContext): PipelineStep[] {
  const jscpd = toolCommand(TOOLS.jscpd, ctx.cwd);
  if (!jscpd) {
    return [];
  }
  const config = ctx.config.duplication;
  const withReport = reportEnabled(ctx);
  const args = [
    "--threshold",
    String(config?.threshold ?? 0),
    "--reporters",
    withReport ? "console,sarif" : "console",
  ];
  if (withReport) {
    args.push("--output", reportDir(ctx));
  }
  if (config?.minTokens !== undefined) {
    args.push("--min-tokens", String(config.minTokens));
  }
  if (config?.ignore && config.ignore.length > 0) {
    args.push("--ignore", config.ignore.join(","));
  }
  // Code formats only: lockfiles and generated JSON repeat by nature and would
  // fail every project's first run.
  args.push("--format", (config?.formats ?? DUPLICATION_FORMATS).join(","));
  args.push(...duplicationPaths(ctx));
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
  // Lint-only, warnings as errors, source only. Rules come from the project's
  // Biome config. `--only` is deliberately NOT used: it forces a rule group on
  // and overrides rules the project set to "off". Projects scope this by adding
  // overrides to their own biome.json. See docs/plan.md.
  const target = existsSync(join(ctx.cwd, "src")) ? "src" : ".";
  return [
    step("smells", biome, [
      "lint",
      ...biomeConfigArgs(ctx),
      ...biomeSarifArgs(ctx, "biome-smells.sarif"),
      "--error-on-warnings",
      target,
    ]),
  ];
}

function auditArgs(pm: PackageManagerKind, level: string, production: boolean): string[] {
  // Yarn classic returns a severity bitmask from `audit` and does not accept
  // --audit-level, so it is run with a group filter only.
  if (pm === "yarn") {
    return production ? ["audit", "--groups", "dependencies"] : ["audit"];
  }

  const args = ["audit", "--audit-level", level];
  if (production) {
    if (pm === "npm") {
      args.push("--omit=dev");
    } else if (pm === "pnpm") {
      args.push("--prod");
    }
    // bun audit has no production-only flag; it always audits everything.
  }
  return args;
}

export function buildAuditStep(ctx: BuildContext): PipelineStep[] {
  if (!ctx.project.hasPackageJson) {
    return [];
  }
  const level = ctx.config.audit?.level ?? "high";
  const production = ctx.config.audit?.production ?? true;
  return [
    {
      name: "audit",
      command: ctx.project.packageManager,
      args: auditArgs(ctx.project.packageManager, level, production),
      // Run where the lockfile lives, which in a monorepo is the workspace root.
      cwd: ctx.project.root,
    },
  ];
}

function stylesApplicable(ctx: BuildContext): boolean {
  if (ctx.config.styles?.enabled !== undefined) {
    return ctx.config.styles.enabled;
  }
  return ctx.project.hasStylelintConfig || ctx.project.hasTailwind || ctx.project.hasScss;
}

/**
 * CSS/Tailwind/SCSS gate. Opt-in: runs only when the project has a stylelint
 * config, Tailwind, or SCSS. Uses the shipped preset when the project has no
 * stylelint config of its own.
 */
export function buildStylesStep(ctx: BuildContext): PipelineStep[] {
  if (!stylesApplicable(ctx)) {
    return [];
  }
  const stylelint = toolCommand(TOOLS.stylelint, ctx.cwd);
  if (!stylelint) {
    return [];
  }

  const { hasTailwind, hasScss, hasStylelintConfig } = ctx.project;
  const preset = hasTailwind ? "tailwind" : hasScss ? "scss" : "base";
  const configPath =
    ctx.config.styles?.configPath ??
    (hasStylelintConfig
      ? null
      : resolvePackageFile(
          "@develoz/quality-assurance-config",
          `stylelint/stylelint.${preset}.json`,
          ctx.cwd
        ));

  const files = ctx.config.styles?.files ?? (hasScss ? ["**/*.css", "**/*.scss"] : ["**/*.css"]);
  const args = ["--allow-empty-input"];
  if (configPath) {
    args.push(`--config=${configPath}`);
  }
  if (hasScss) {
    args.push("--custom-syntax=postcss-scss");
  }
  if (reportEnabled(ctx)) {
    args.push("--formatter=json", `--output-file=${join(reportDir(ctx), "stylelint.json")}`);
  }
  args.push(...files);

  return [step("styles", stylelint, args)];
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
    ...buildStylesStep(ctx),
    ...buildCoverageStep(ctx),
  ];
}

/** True when at least one TypeScript file is staged. Drives the pre-commit typecheck. */
export function hasStagedTypeScript(cwd: string): boolean {
  return listStagedFiles(cwd, ["ts", "tsx"]).length > 0;
}

/**
 * Pre-commit gates: staged lint, staged format only when the formatter is not
 * Biome (`biome check` already formats), and a full typecheck when TypeScript
 * is staged. The typecheck never takes a file list.
 */
export function buildPreCommitSteps(
  ctx: BuildContext,
  options: { stagedTypeScript: boolean }
): PipelineStep[] {
  const steps = [...buildLintSteps(ctx, { staged: true })];

  if ((ctx.config.formatter ?? "biome") !== "biome") {
    steps.push(...buildFormatSteps(ctx, { staged: true }));
  }
  if (options.stagedTypeScript) {
    steps.push(...buildTypecheckStep(ctx));
  }
  return steps;
}
