import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  countResults,
  type DependencyCruiserReport,
  dependencyCruiserToSarif,
  isSarifLog,
  mergeSarif,
  type SarifLog,
  type StylelintFileResult,
  stylelintToSarif,
} from "./sarif.js";

export const DEFAULT_REPORT_DIR = "dist/qa";
export const REPORT_FILE = "qa.sarif";

/** SARIF files written by the individual gates. */
const SARIF_INPUTS = ["biome.sarif", "biome-smells.sarif", "jscpd-report.sarif"] as const;
const DEPCRUISER_INPUT = "dependency-cruiser.json";
const STYLELINT_INPUT = "stylelint.json";

export interface BuildReportResult {
  outputPath: string;
  resultCount: number;
  inputs: string[];
}

function tryReadJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    return null;
  }
}

/**
 * Merges the SARIF each gate writes plus the dependency-cruiser JSON (converted
 * to SARIF) into a single file for GitHub code scanning.
 */
export function buildReport(directory: string): BuildReportResult {
  const logs: SarifLog[] = [];
  const inputs: string[] = [];

  for (const name of SARIF_INPUTS) {
    const parsed = tryReadJson(join(directory, name));
    if (isSarifLog(parsed)) {
      logs.push(parsed);
      inputs.push(name);
    }
  }

  const depcruise = tryReadJson(join(directory, DEPCRUISER_INPUT));
  if (depcruise !== null) {
    logs.push(dependencyCruiserToSarif(depcruise as DependencyCruiserReport));
    inputs.push(DEPCRUISER_INPUT);
  }

  const stylelint = tryReadJson(join(directory, STYLELINT_INPUT));
  if (Array.isArray(stylelint)) {
    logs.push(stylelintToSarif(stylelint as StylelintFileResult[]));
    inputs.push(STYLELINT_INPUT);
  }

  const merged = mergeSarif(logs);
  mkdirSync(directory, { recursive: true });
  const outputPath = join(directory, REPORT_FILE);
  writeFileSync(outputPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  return { outputPath, resultCount: countResults(merged), inputs };
}
