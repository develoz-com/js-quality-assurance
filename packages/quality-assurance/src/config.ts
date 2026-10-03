import type { PipelineStep } from "./pipeline/types.js";

export type StackKind = "node" | "react" | "next";
export type LinterKind = "biome" | "eslint";
export type FormatterKind = "biome" | "prettier";
export type AuditLevel = "low" | "moderate" | "high" | "critical";

export interface CoverageConfig {
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
