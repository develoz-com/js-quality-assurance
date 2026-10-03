import { describe, expect, it } from "vitest";
import { checkThresholds, parseLcov, percentage } from "../src/coverage-lcov.js";

const LCOV = [
  "TN:",
  "SF:/repo/src/a.ts",
  "FNF:4",
  "FNH:3",
  "LF:10",
  "LH:9",
  "BRF:6",
  "BRH:3",
  "end_of_record",
  "TN:",
  "SF:/repo/test/helpers.js",
  "FNF:5",
  "FNH:0",
  "LF:20",
  "LH:0",
  "end_of_record",
  "SF:/repo/src/b.ts",
  "FNF:1",
  "FNH:1",
  "LF:5",
  "LH:5",
  "end_of_record",
].join("\n");

describe("parseLcov", () => {
  it("sums lines, functions and branches across records", () => {
    const totals = parseLcov(LCOV);
    expect(totals.lines).toEqual({ found: 35, hit: 14 });
    expect(totals.functions).toEqual({ found: 10, hit: 4 });
    expect(totals.branches).toEqual({ found: 6, hit: 3 });
  });

  it("skips records whose source matches an ignore pattern", () => {
    const totals = parseLcov(LCOV, ["test/"]);
    expect(totals.lines).toEqual({ found: 15, hit: 14 });
    expect(totals.functions).toEqual({ found: 5, hit: 4 });
  });

  it("returns zero totals for an empty report", () => {
    expect(parseLcov("").lines).toEqual({ found: 0, hit: 0 });
  });

  it("ignores malformed numeric values", () => {
    const totals = parseLcov("SF:/x.ts\nLF:abc\nLH:2\nend_of_record\n");
    expect(totals.lines).toEqual({ found: 0, hit: 2 });
  });
});

describe("percentage", () => {
  it("computes a ratio and treats empty metrics as fully covered", () => {
    expect(percentage({ found: 4, hit: 3 })).toBe(75);
    expect(percentage({ found: 0, hit: 0 })).toBe(100);
  });
});

describe("checkThresholds", () => {
  const actual = parseLcov(LCOV, ["test/"]);

  it("passes when every measured metric meets its minimum", () => {
    expect(checkThresholds(actual, { lines: 90, functions: 80, branches: 50 })).toEqual([]);
  });

  it("reports each metric below its minimum", () => {
    const violations = checkThresholds(actual, { lines: 100, functions: 100, branches: 50 });
    expect(violations.map((violation) => violation.metric)).toEqual(["lines", "functions"]);
    expect(violations[0]?.minimum).toBe(100);
  });

  it("skips metrics with no measurable entries", () => {
    const noBranches = parseLcov("SF:/a.ts\nLF:2\nLH:2\nFNF:1\nFNH:1\nend_of_record\n");
    expect(checkThresholds(noBranches, { lines: 100, functions: 100, branches: 100 })).toEqual([]);
  });
});
