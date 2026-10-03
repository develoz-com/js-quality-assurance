import { describe, expect, it } from "vitest";
import { resolveCoverage } from "../src/coverage.js";

describe("resolveCoverage", () => {
  it("defaults to 100% on all metrics", () => {
    const coverage = resolveCoverage({ env: {}, config: {} });
    expect(coverage).toMatchObject({
      lines: 100,
      branches: 100,
      functions: 100,
      statements: 100,
      provider: "v8",
      perFile: false,
    });
  });

  it("lets project config override the default", () => {
    const coverage = resolveCoverage({ env: {}, config: { lines: 90, branches: 80 } });
    expect(coverage.lines).toBe(90);
    expect(coverage.branches).toBe(80);
    expect(coverage.functions).toBe(100);
  });

  it("lets environment override project config", () => {
    const coverage = resolveCoverage({
      env: { QA_COVERAGE_LINES: "75", QA_COVERAGE_BRANCHES: "50" },
      config: { lines: 90, branches: 80 },
    });
    expect(coverage.lines).toBe(75);
    expect(coverage.branches).toBe(50);
  });

  it("ignores empty and non-numeric environment values", () => {
    const coverage = resolveCoverage({
      env: { QA_COVERAGE_LINES: "", QA_COVERAGE_BRANCHES: "abc" },
      config: { lines: 90, branches: 80 },
    });
    expect(coverage.lines).toBe(90);
    expect(coverage.branches).toBe(80);
  });

  it("carries provider and perFile", () => {
    const coverage = resolveCoverage({ env: {}, config: { provider: "istanbul", perFile: true } });
    expect(coverage.provider).toBe("istanbul");
    expect(coverage.perFile).toBe(true);
  });
});
