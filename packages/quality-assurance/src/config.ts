import type { PipelineStep } from "./pipeline/types.js";

export type StackKind = "node" | "react" | "next";
export type TestRunnerKind = "vitest" | "bun";
export type LinterKind = "biome" | "eslint";
export type FormatterKind = "biome" | "prettier";
export type AuditLevel = "low" | "moderate" | "high" | "critical";

export interface TestConfig {
  /**
   * Test runner. Auto-detected when omitted: `bun` when tests import `bun:test`
   * or the project has a bunfig.toml, otherwise `vitest`.
   */
  runner?: TestRunnerKind;
}

export interface CoverageConfig {
  /**
   * Globs excluded from the coverage gate on the bun runner (lcov is parsed by
   * qa, so test files and helpers can be kept out). Substring match on the
   * source path with `*` ignored. Default: test directories, colocated
   * `.test.`/`.spec.` files, coverage output and node_modules. Build output is
   * not excluded: tests that run against a built bundle are measured through it.
   */
  exclude?: readonly string[];
  /** Minimum percent, or a negative number for "at most N uncovered". */
  lines?: number;
  branches?: number;
  functions?: number;
  statements?: number;
  provider?: "v8" | "istanbul";
  perFile?: boolean;
}

export interface AuditConfig {
  level?: AuditLevel;
  ignoreAdvisories?: readonly string[];
  /**
   * Audit production dependencies only. Default true: a project's dev toolchain
   * (including this one) should not gate its build on dev-only advisories.
   */
  production?: boolean;
}

export interface BoundariesConfig {
  enabled?: boolean;
  rulesPath?: string;
}

export interface DeadcodeConfig {
  strict?: boolean;
  ignore?: readonly string[];
}

export interface DuplicationConfig {
  /** Maximum duplication percentage before failing. Default 0 (fail on any). */
  threshold?: number;
  minTokens?: number;
  ignore?: readonly string[];
  /**
   * Paths to scan. Default: `src` when it exists, else the project root.
   * Scanning the root also reads lockfiles and generated JSON, which repeat by
   * nature, so prefer a source directory.
   */
  paths?: readonly string[];
  /** Languages to scan. Default: JavaScript and TypeScript only. */
  formats?: readonly string[];
}

export interface SmellsConfig {
  /** `biome` uses complexity/suspicious rules; `eslint` expects sonarjs-style plugins. */
  tool?: "biome" | "eslint";
}

export interface ReportConfig {
  /** Defaults to true when CI or GITHUB_ACTIONS is set. */
  enabled?: boolean;
  /** Directory for SARIF/JUnit artifacts, relative to the project. */
  directory?: string;
}

export interface StylesConfig {
  /** Force on/off. Default is auto-detect: a stylelint config, Tailwind or SCSS. */
  enabled?: boolean;
  /** Override the stylesheet globs passed to stylelint. */
  files?: readonly string[];
  /** Explicit stylelint config path. */
  configPath?: string;
}

export interface PipelineConfig {
  preSteps?: readonly PipelineStep[];
  postSteps?: readonly PipelineStep[];
}

export interface QaConfig {
  /** Auto-detected when omitted. */
  stack?: StackKind;
  linter?: LinterKind;
  formatter?: FormatterKind;
  coverage?: CoverageConfig;
  test?: TestConfig;
  audit?: AuditConfig;
  boundaries?: BoundariesConfig;
  deadcode?: DeadcodeConfig;
  duplication?: DuplicationConfig;
  smells?: SmellsConfig;
  report?: ReportConfig;
  styles?: StylesConfig;
  pipeline?: PipelineConfig;
}

/** Identity helper that gives editors type inference for `qa.config.*`. */
export function defineConfig(config: QaConfig): QaConfig {
  return config;
}

export const DEFAULT_COVERAGE_THRESHOLDS = {
  lines: 100,
  branches: 100,
  functions: 100,
  statements: 100,
} as const;
