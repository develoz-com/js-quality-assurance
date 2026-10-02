import { describe, expect, it } from "vitest";
import {
  countResults,
  dependencyCruiserToSarif,
  isSarifLog,
  mergeSarif,
  SARIF_SCHEMA,
} from "../src/reporters/sarif.js";

describe("dependencyCruiserToSarif", () => {
  it("maps violations to results with levels, locations and rules", () => {
    const log = dependencyCruiserToSarif({
      summary: {
        violations: [
          {
            type: "dependency",
            from: "src/a.ts",
            to: "src/b.ts",
            unresolvedTo: "./b.js",
            rule: { severity: "error", name: "no-internal" },
          },
          {
            type: "dependency",
            from: "src/c.ts",
            to: "src/d.ts",
            rule: { severity: "warn", name: "soft" },
          },
        ],
      },
    });

    expect(log.version).toBe("2.1.0");
    expect(log.runs[0]?.tool.driver.name).toBe("dependency-cruiser");
    expect(countResults(log)).toBe(2);
    expect(log.runs[0]?.results[0]?.level).toBe("error");
    expect(log.runs[0]?.results[0]?.locations[0]?.physicalLocation.artifactLocation.uri).toBe(
      "src/a.ts"
    );
    expect(log.runs[0]?.results[0]?.message.text).toContain("src/a.ts -> ./b.js");
    expect(log.runs[0]?.results[1]?.level).toBe("warning");
    expect(log.runs[0]?.tool.driver.rules?.map((rule) => rule.id)).toEqual(["no-internal", "soft"]);
  });

  it("handles an empty report", () => {
    expect(countResults(dependencyCruiserToSarif({}))).toBe(0);
  });
});

describe("mergeSarif", () => {
  it("concatenates runs and results", () => {
    const first = dependencyCruiserToSarif({
      summary: { violations: [{ from: "a", to: "b", rule: { name: "r", severity: "error" } }] },
    });
    const second = dependencyCruiserToSarif({
      summary: { violations: [{ from: "c", to: "d", rule: { name: "s", severity: "error" } }] },
    });

    const merged = mergeSarif([first, second]);

    expect(merged.runs).toHaveLength(2);
    expect(countResults(merged)).toBe(2);
    expect(merged.$schema).toBe(SARIF_SCHEMA);
  });

  it("returns an empty log with no inputs", () => {
    expect(mergeSarif([]).runs).toEqual([]);
  });
});

describe("isSarifLog", () => {
  it("accepts a sarif log and rejects other values", () => {
    expect(isSarifLog(dependencyCruiserToSarif({}))).toBe(true);
    expect(isSarifLog({})).toBe(false);
    expect(isSarifLog(null)).toBe(false);
  });
});
