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

/** Single-run SARIF files, one per tool, for code scanning (one run per category). */
const PER_TOOL_SARIF = {
  biome: "biome.sarif",
  biomeSmells: "biome-smells.sarif",
  jscpd: "jscpd-report.sarif",
  boundaries: "dependency-cruiser.sarif",
  stylelint: "stylelint.sarif",
} as const;

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

function writeSarif(directory: string, name: string, log: SarifLog): void {
  writeFileSync(join(directory, name), `${JSON.stringify(log, null, 2)}\n`, "utf8");
}

/**
 * Merges the SARIF each gate writes plus the dependency-cruiser and stylelint
 * JSON (converted to SARIF) into a single file. It also writes one single-run
 * SARIF file per tool, because code scanning rejects multiple runs sharing a
 * category.
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
    const log = dependencyCruiserToSarif(depcruise as DependencyCruiserReport);
    logs.push(log);
    inputs.push(DEPCRUISER_INPUT);
    mkdirSync(directory, { recursive: true });
    writeSarif(directory, PER_TOOL_SARIF.boundaries, log);
  }

  const stylelint = tryReadJson(join(directory, STYLELINT_INPUT));
  if (Array.isArray(stylelint)) {
    const log = stylelintToSarif(stylelint as StylelintFileResult[]);
    logs.push(log);
    inputs.push(STYLELINT_INPUT);
    mkdirSync(directory, { recursive: true });
    writeSarif(directory, PER_TOOL_SARIF.stylelint, log);
  }

  const merged = mergeSarif(logs);
  mkdirSync(directory, { recursive: true });
  const outputPath = join(directory, REPORT_FILE);
  writeSarif(directory, REPORT_FILE, merged);

  return { outputPath, resultCount: countResults(merged), inputs };
}
