import { type CoverageConfig, DEFAULT_COVERAGE_THRESHOLDS } from "./config.js";

export interface ResolvedCoverage {
  lines: number;
  branches: number;
  functions: number;
  statements: number;
  provider: "v8" | "istanbul";
  perFile: boolean;
}

export interface CoverageSources {
  env?: NodeJS.ProcessEnv | undefined;
  config?: CoverageConfig | undefined;
}

type ThresholdKey = "lines" | "branches" | "functions" | "statements";

const ENV_KEYS: Record<ThresholdKey, string> = {
  lines: "QA_COVERAGE_LINES",
  branches: "QA_COVERAGE_BRANCHES",
  functions: "QA_COVERAGE_FUNCTIONS",
  statements: "QA_COVERAGE_STATEMENTS",
};

function fromEnv(env: NodeJS.ProcessEnv, key: ThresholdKey): number | undefined {
  const raw = env[ENV_KEYS[key]];
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Precedence: environment over project config over the opinionated default
 * (100% lines and branches), mirroring the Ruby gem.
 */
export function resolveCoverage(sources: CoverageSources = {}): ResolvedCoverage {
  const env = sources.env ?? process.env;
  const config = sources.config ?? {};

  const pick = (key: ThresholdKey): number =>
    fromEnv(env, key) ?? config[key] ?? DEFAULT_COVERAGE_THRESHOLDS[key];

  return {
    lines: pick("lines"),
    branches: pick("branches"),
    functions: pick("functions"),
    statements: pick("statements"),
    provider: config.provider ?? "v8",
    perFile: config.perFile ?? false,
  };
}
