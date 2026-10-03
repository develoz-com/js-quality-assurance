export interface CoverageTotals {
  found: number;
  hit: number;
}

export interface LcovCoverage {
  lines: CoverageTotals;
  functions: CoverageTotals;
  branches: CoverageTotals;
}

type CoverageMetric = "lines" | "functions" | "branches";

export interface CoverageViolation {
  metric: CoverageMetric;
  actual: number;
  minimum: number;
}

const EMPTY = (): LcovCoverage => ({
  lines: { found: 0, hit: 0 },
  functions: { found: 0, hit: 0 },
  branches: { found: 0, hit: 0 },
});

function isIgnored(source: string, ignore: readonly string[]): boolean {
  return ignore.some((pattern) => {
    const needle = pattern.replace(/\*/g, "");
    return needle.length > 0 && source.includes(needle);
  });
}

/**
 * Parses lcov into coverage totals. lcov carries line, function and branch
 * totals; there is no statement metric, so statements cannot be enforced from
 * it. Records whose source matches an ignore pattern are skipped, which is how
 * test files are kept out of a source-coverage gate.
 */
export function parseLcov(text: string, ignore: readonly string[] = []): LcovCoverage {
  const totals = EMPTY();
  let source = "";
  let skipped = false;

  for (const line of text.split("\n")) {
    if (line.startsWith("SF:")) {
      source = line.slice(3).trim();
      skipped = isIgnored(source, ignore);
      continue;
    }
    if (skipped) {
      if (line.startsWith("end_of_record")) {
        source = "";
        skipped = false;
      }
      continue;
    }

    const value = (prefix: string): number | null => {
      if (!line.startsWith(prefix)) return null;
      const parsed = Number(line.slice(prefix.length).trim());
      return Number.isFinite(parsed) ? parsed : null;
    };

    const lf = value("LF:");
    if (lf !== null) {
      totals.lines.found += lf;
      continue;
    }
    const lh = value("LH:");
    if (lh !== null) {
      totals.lines.hit += lh;
      continue;
    }
    const fnf = value("FNF:");
    if (fnf !== null) {
      totals.functions.found += fnf;
      continue;
    }
    const fnh = value("FNH:");
    if (fnh !== null) {
      totals.functions.hit += fnh;
      continue;
    }
    const brf = value("BRF:");
    if (brf !== null) {
      totals.branches.found += brf;
      continue;
    }
    const brh = value("BRH:");
    if (brh !== null) {
      totals.branches.hit += brh;
    }
  }

  return totals;
}

/** Percentage covered, or 100 when the metric has no measurable entries. */
export function percentage(totals: CoverageTotals): number {
  if (totals.found === 0) return 100;
  return (totals.hit / totals.found) * 100;
}

export interface CoverageMinimums {
  lines: number;
  functions: number;
  branches: number;
}

/** Metrics with no measurable entries are skipped rather than failed. */
export function checkThresholds(
  actual: LcovCoverage,
  minimums: CoverageMinimums
): CoverageViolation[] {
  const violations: CoverageViolation[] = [];
  for (const metric of ["lines", "functions", "branches"] as const) {
    if (actual[metric].found === 0) continue;
    const value = percentage(actual[metric]);
    if (value < minimums[metric]) {
      violations.push({ metric, actual: value, minimum: minimums[metric] });
    }
  }
  return violations;
}
