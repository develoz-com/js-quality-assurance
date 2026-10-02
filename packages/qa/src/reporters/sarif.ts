export interface SarifRule {
  id: string;
  name?: string;
  shortDescription?: { text: string };
}

export interface SarifResult {
  ruleId: string;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string };
      region?: { startLine?: number; startColumn?: number };
    };
  }>;
}

export interface SarifRun {
  tool: { driver: { name: string; informationUri?: string; rules?: SarifRule[] } };
  results: SarifResult[];
}

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: SarifRun[];
}

export const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";

interface DependencyCruiserViolation {
  type?: string;
  from?: string;
  to?: string;
  unresolvedTo?: string;
  rule?: { severity?: string; name?: string };
}

export interface DependencyCruiserReport {
  summary?: { violations?: DependencyCruiserViolation[] };
}

interface StylelintWarning {
  line?: number;
  column?: number;
  rule?: string;
  severity?: string;
  text?: string;
}

export interface StylelintFileResult {
  source?: string;
  warnings?: StylelintWarning[];
}

function emptySarif(toolName: string, informationUri?: string): SarifLog {
  return {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: { driver: informationUri ? { name: toolName, informationUri } : { name: toolName } },
        results: [],
      },
    ],
  };
}

/**
 * dependency-cruiser emits JSON but not SARIF, and refuses to fail the build on
 * violations when `--output-type json` is used. This converts its report for
 * code scanning; the gate itself stays on `--output-type err`.
 */
export function dependencyCruiserToSarif(report: DependencyCruiserReport): SarifLog {
  const log = emptySarif("dependency-cruiser", "https://github.com/sverweij/dependency-cruiser");
  const run = log.runs[0];
  if (!run) {
    return log;
  }

  const rules = new Map<string, SarifRule>();
  for (const violation of report.summary?.violations ?? []) {
    const ruleId = violation.rule?.name ?? "dependency-cruiser";
    if (!rules.has(ruleId)) {
      rules.set(ruleId, { id: ruleId, name: ruleId, shortDescription: { text: ruleId } });
    }
    const target = violation.unresolvedTo ?? violation.to ?? "?";
    run.results.push({
      ruleId,
      level: violation.rule?.severity === "error" ? "error" : "warning",
      message: { text: `${violation.type ?? "dependency"}: ${violation.from ?? "?"} -> ${target}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: violation.from ?? "unknown" } } }],
    });
  }

  if (rules.size > 0) {
    run.tool.driver.rules = [...rules.values()];
  }
  return log;
}

/**
 * Converts Stylelint's JSON formatter output (an array of file results) into
 * SARIF. Stylelint has no built-in SARIF formatter.
 */
export function stylelintToSarif(results: readonly StylelintFileResult[]): SarifLog {
  const log = emptySarif("stylelint", "https://stylelint.io");
  const run = log.runs[0];
  if (!run) {
    return log;
  }

  const rules = new Map<string, SarifRule>();
  for (const file of results) {
    for (const warning of file.warnings ?? []) {
      const ruleId = warning.rule ?? "stylelint";
      if (!rules.has(ruleId)) {
        rules.set(ruleId, { id: ruleId, name: ruleId, shortDescription: { text: ruleId } });
      }
      const region: { startLine?: number; startColumn?: number } = {};
      if (warning.line !== undefined) {
        region.startLine = warning.line;
      }
      if (warning.column !== undefined) {
        region.startColumn = warning.column;
      }
      run.results.push({
        ruleId,
        level: warning.severity === "error" ? "error" : "warning",
        message: { text: warning.text ?? ruleId },
        locations: [
          {
            physicalLocation: {
              artifactLocation: { uri: file.source ?? "unknown" },
              ...(Object.keys(region).length > 0 ? { region } : {}),
            },
          },
        ],
      });
    }
  }

  if (rules.size > 0) {
    run.tool.driver.rules = [...rules.values()];
  }
  return log;
}

/** Concatenates SARIF runs. Deduplication is left to the consumer. */
export function mergeSarif(logs: readonly SarifLog[]): SarifLog {
  const runs: SarifRun[] = [];
  for (const log of logs) {
    runs.push(...log.runs);
  }
  return { $schema: SARIF_SCHEMA, version: "2.1.0", runs };
}

export function countResults(log: SarifLog): number {
  return log.runs.reduce((total, run) => total + run.results.length, 0);
}

export function isSarifLog(value: unknown): value is SarifLog {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    "runs" in value &&
    Array.isArray((value as { runs?: unknown }).runs)
  );
}
