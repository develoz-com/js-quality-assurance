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
}

export interface BoundariesConfig {
  enabled?: boolean;
  rulesPath?: string;
}

export interface DeadcodeConfig {
  strict?: boolean;
  ignore?: readonly string[];
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
