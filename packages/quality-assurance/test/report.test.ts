import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildReport, REPORT_FILE } from "../src/reporters/report.js";
import { dependencyCruiserToSarif } from "../src/reporters/sarif.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "qa-report-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("buildReport", () => {
  it("merges sarif artifacts and dependency-cruiser json into qa.sarif", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "biome.sarif"),
      JSON.stringify(
        dependencyCruiserToSarif({
          summary: { violations: [{ from: "x", to: "y", rule: { name: "r", severity: "error" } }] },
        })
      )
    );
    writeFileSync(
      join(dir, "dependency-cruiser.json"),
      JSON.stringify({
        summary: {
          violations: [{ from: "a", to: "b", rule: { name: "no-internal", severity: "error" } }],
        },
      })
    );

    const result = buildReport(dir);

    expect(result.inputs.sort()).toEqual(["biome.sarif", "dependency-cruiser.json"]);
    expect(result.resultCount).toBe(2);
    const written = JSON.parse(readFileSync(join(dir, REPORT_FILE), "utf8")) as { runs: unknown[] };
    expect(written.runs).toHaveLength(2);
  });

  it("writes an empty sarif when there are no artifacts", () => {
    const result = buildReport(tempDir());
    expect(result.inputs).toEqual([]);
    expect(result.resultCount).toBe(0);
  });

  it("skips malformed artifacts", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "biome.sarif"), "{ not json");
    expect(buildReport(dir).inputs).toEqual([]);
  });

  it("converts stylelint json", () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "stylelint.json"),
      JSON.stringify([
        {
          source: "a.css",
          warnings: [{ line: 1, column: 1, rule: "r", severity: "error", text: "x" }],
        },
      ])
    );

    const result = buildReport(dir);

    expect(result.inputs).toEqual(["stylelint.json"]);
    expect(result.resultCount).toBe(1);
  });
});
