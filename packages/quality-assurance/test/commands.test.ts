import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type BuildContext,
  buildAuditStep,
  buildBoundariesStep,
  buildCiSteps,
  buildCoverageStep,
  buildDeadcodeStep,
  buildDuplicationStep,
  buildFormatSteps,
  buildLintSteps,
  buildPreCommitSteps,
  buildSmellsStep,
  buildStylesStep,
  buildTestStep,
  buildTypecheckStep,
  coverageExclude,
  hasStagedTypeScript,
} from "../src/commands.js";
import { resolveCoverage } from "../src/coverage.js";
import type { ProjectInfo } from "../src/stacks.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const defaultProject: ProjectInfo = {
  root: packageRoot,
  stack: "node",
  packageManager: "npm",
  hasPackageJson: true,
  hasTypeScript: true,
  hasTailwind: false,
  hasScss: false,
  hasStylelintConfig: false,
  testRunner: "vitest",
};

function makeContext(overrides: Partial<BuildContext> = {}): BuildContext {
  const { config, ...rest } = overrides;
  return {
    cwd: packageRoot,
    // Reporting is pinned off so unit tests do not depend on an ambient CI env.
    config: { report: { enabled: false }, ...(config ?? {}) },
    project: defaultProject,
    coverage: resolveCoverage({ env: {}, config: {} }),
    ...rest,
  };
}

describe("buildLintSteps", () => {
  it("defaults to biome check", () => {
    const steps = buildLintSteps(makeContext());
    expect(steps).toHaveLength(1);
    expect(steps[0]?.args).toContain("check");
  });

  it("passes --staged and --write to biome", () => {
    const steps = buildLintSteps(makeContext(), { staged: true, fix: true });
    expect(steps[0]?.args).toContain("--staged");
    expect(steps[0]?.args).toContain("--write");
  });

  it("uses eslint when configured", () => {
    const steps = buildLintSteps(makeContext({ config: { linter: "eslint" } }));
    expect(steps).toHaveLength(1);
    expect(steps[0]?.args).toContain(".");
  });

  it("adds --fix for eslint", () => {
    const steps = buildLintSteps(makeContext({ config: { linter: "eslint" } }), { fix: true });
    expect(steps[0]?.args).toContain("--fix");
  });
});

describe("buildFormatSteps", () => {
  it("defaults to biome format", () => {
    const steps = buildFormatSteps(makeContext());
    expect(steps[0]?.args).toContain("format");
  });

  it("uses prettier --write when configured", () => {
    const steps = buildFormatSteps(makeContext({ config: { formatter: "prettier" } }), {
      write: true,
    });
    expect(steps[0]?.args).toContain("--write");
    expect(steps[0]?.args).toContain(".");
  });

  it("uses prettier --check by default", () => {
    const steps = buildFormatSteps(makeContext({ config: { formatter: "prettier" } }));
    expect(steps[0]?.args).toContain("--check");
  });
});

describe("buildTypecheckStep and buildTestStep", () => {
  it("runs tsc --noEmit", () => {
    expect(buildTypecheckStep(makeContext())[0]?.args).toContain("--noEmit");
  });

  it("runs vitest without coverage", () => {
    const args = buildTestStep(makeContext())[0]?.args ?? [];
    expect(args).toContain("run");
    expect(args).not.toContain("--coverage");
  });
});

describe("buildCoverageStep", () => {
  it("injects resolved thresholds in a single run", () => {
    const ctx = makeContext({
      coverage: resolveCoverage({ env: {}, config: { lines: 90, branches: 85 } }),
    });
    const args = buildCoverageStep(ctx)[0]?.args ?? [];
    expect(args).toContain("--coverage");
    expect(args).toContain("--coverage.thresholds.lines=90");
    expect(args).toContain("--coverage.thresholds.branches=85");
    expect(args).toContain("--coverage.thresholds.statements=100");
  });
});

describe("bun runner", () => {
  const bunContext = (config: BuildContext["config"] = {}) =>
    makeContext({ project: { ...defaultProject, testRunner: "bun" }, config });

  it("runs bun test for the test step", () => {
    const step = buildTestStep(bunContext())[0];
    expect(step?.command).toBe("bun");
    expect(step?.args).toEqual(["test"]);
  });

  it("writes lcov, then enforces thresholds in a separate step", () => {
    const steps = buildCoverageStep(bunContext());
    expect(steps.map((step) => step.name)).toEqual(["coverage", "coverage:check"]);
    expect(steps[0]?.command).toBe("bun");
    expect(steps[0]?.args).toContain("--coverage");
    expect(steps[0]?.args).toContain("--coverage-reporter=lcov");
    expect(steps[1]?.args).toContain("coverage:check");
    expect(steps[1]?.args?.at(-1)).toMatch(/lcov\.info$/);
  });

  it("does not use vitest flags for bun", () => {
    const args = buildCoverageStep(bunContext()).flatMap((step) => step.args ?? []);
    expect(args.some((arg) => arg.startsWith("--coverage.thresholds"))).toBe(false);
  });

  it("does not exclude build output from the measured set by default", () => {
    const exclude = coverageExclude(bunContext());
    expect(exclude).not.toContain("dist/");
    expect(exclude).toContain("test/");
    expect(exclude).toContain(".test.");
  });

  it("lets config replace the exclusions", () => {
    expect(coverageExclude(bunContext({ coverage: { exclude: ["fixtures/"] } }))).toEqual([
      "fixtures/",
    ]);
  });

  it("lets config force a runner over detection", () => {
    const step = buildTestStep(makeContext({ config: { test: { runner: "bun" } } }))[0];
    expect(step?.command).toBe("bun");
  });

  it("keeps vitest when config says vitest even for a bun project", () => {
    const ctx = makeContext({
      project: { ...defaultProject, testRunner: "bun" },
      config: { test: { runner: "vitest" } },
    });
    expect(buildCoverageStep(ctx)[0]?.name).toBe("coverage");
    expect(buildCoverageStep(ctx)[0]?.command).not.toBe("bun");
  });
});

describe("buildDeadcodeStep", () => {
  it("runs knip quietly", () => {
    expect(buildDeadcodeStep(makeContext())[0]?.args).toContain("--no-progress");
  });

  it("treats config hints as errors when strict", () => {
    const steps = buildDeadcodeStep(makeContext({ config: { deadcode: { strict: true } } }));
    expect(steps[0]?.args).toContain("--treat-config-hints-as-errors");
  });
});

describe("buildDuplicationStep", () => {
  it("fails on any duplication by default", () => {
    const args = buildDuplicationStep(makeContext())[0]?.args ?? [];
    expect(args).toContain("--threshold");
    expect(args).toContain("0");
    expect(args).toContain("console");
  });

  it("scans code formats only, so lockfiles and generated JSON never count", () => {
    const args = buildDuplicationStep(makeContext())[0]?.args ?? [];
    const index = args.indexOf("--format");
    expect(index).toBeGreaterThan(-1);
    expect(args[index + 1]).toBe("javascript,typescript,jsx,tsx");
    expect(args[index + 1]).not.toContain("json");
  });

  it("scans src when it exists, otherwise the project root", () => {
    const withSrc = mkdtempSync(join(tmpdir(), "qa-dup-src-"));
    const withoutSrc = mkdtempSync(join(tmpdir(), "qa-dup-nosrc-"));
    try {
      mkdirSync(join(withSrc, "src"));
      const scoped = buildDuplicationStep(
        makeContext({ cwd: withSrc, project: { ...defaultProject, root: withSrc } })
      )[0]?.args;
      const rooted = buildDuplicationStep(
        makeContext({ cwd: withoutSrc, project: { ...defaultProject, root: withoutSrc } })
      )[0]?.args;
      expect(scoped?.at(-1)).toBe("src");
      expect(rooted?.at(-1)).toBe(".");
    } finally {
      rmSync(withSrc, { recursive: true, force: true });
      rmSync(withoutSrc, { recursive: true, force: true });
    }
  });

  it("honours explicit paths and formats", () => {
    const args =
      buildDuplicationStep(
        makeContext({ config: { duplication: { paths: ["lib", "app"], formats: ["typescript"] } } })
      )[0]?.args ?? [];
    expect(args.slice(-2)).toEqual(["lib", "app"]);
    expect(args[args.indexOf("--format") + 1]).toBe("typescript");
  });

  it("adds sarif and an output directory when reporting is enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-dup-report-"));
    try {
      const ctx = makeContext({
        cwd: dir,
        project: { ...defaultProject, root: dir },
        config: { report: { enabled: true } },
      });
      const args = buildDuplicationStep(ctx)[0]?.args ?? [];
      expect(args).toContain("console,sarif");
      expect(args).toContain("--output");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honours a custom threshold and min tokens", () => {
    const args =
      buildDuplicationStep(
        makeContext({ config: { duplication: { threshold: 5, minTokens: 50 } } })
      )[0]?.args ?? [];
    expect(args).toContain("5");
    expect(args).toContain("--min-tokens");
    expect(args).toContain("50");
  });
});

describe("buildSmellsStep", () => {
  it("runs project-configured biome lint over source, warnings as errors", () => {
    const args = buildSmellsStep(makeContext())[0]?.args ?? [];
    expect(args).toContain("lint");
    expect(args).toContain("--error-on-warnings");
    expect(args).toContain("src");
    // --only would override rules the project turned off.
    expect(args.some((arg) => arg.startsWith("--only"))).toBe(false);
  });
});

describe("buildBoundariesStep", () => {
  it("skips when no rules file exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-nobounds-"));
    try {
      const ctx = makeContext({ cwd: dir, project: { ...defaultProject, root: dir } });
      expect(buildBoundariesStep(ctx)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs when a rules file is present", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-bounds-"));
    try {
      writeFileSync(join(dir, ".dependency-cruiser.cjs"), "module.exports = {};");
      const steps = buildBoundariesStep(
        makeContext({ cwd: dir, config: { boundaries: { rulesPath: ".dependency-cruiser.cjs" } } })
      );
      expect(steps[0]?.args).toContain("--config");
      expect(steps[0]?.args).toContain(".dependency-cruiser.cjs");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildAuditStep", () => {
  it("audits npm production dependencies at high by default", () => {
    const steps = buildAuditStep(makeContext());
    expect(steps[0]?.command).toBe("npm");
    expect(steps[0]?.args).toEqual(["audit", "--audit-level", "high", "--omit=dev"]);
  });

  it("honours package manager and level", () => {
    const steps = buildAuditStep(
      makeContext({
        project: { ...defaultProject, packageManager: "pnpm" },
        config: { audit: { level: "critical" } },
      })
    );
    expect(steps[0]?.command).toBe("pnpm");
    expect(steps[0]?.args).toEqual(["audit", "--audit-level", "critical", "--prod"]);
  });

  it("filters yarn audit to dependency groups", () => {
    const steps = buildAuditStep(
      makeContext({ project: { ...defaultProject, packageManager: "yarn" } })
    );
    expect(steps[0]?.args).toEqual(["audit", "--groups", "dependencies"]);
  });

  it("has no production flag for bun audit", () => {
    const steps = buildAuditStep(
      makeContext({ project: { ...defaultProject, packageManager: "bun" } })
    );
    expect(steps[0]?.args).toEqual(["audit", "--audit-level", "high"]);
  });

  it("audits everything when production is false", () => {
    const steps = buildAuditStep(makeContext({ config: { audit: { production: false } } }));
    expect(steps[0]?.args).toEqual(["audit", "--audit-level", "high"]);
  });

  it("skips without a package.json", () => {
    expect(
      buildAuditStep(makeContext({ project: { ...defaultProject, hasPackageJson: false } }))
    ).toEqual([]);
  });

  it("runs at the workspace root, not the package directory", () => {
    const steps = buildAuditStep(
      makeContext({ project: { ...defaultProject, root: "/workspace/root" } })
    );
    expect(steps[0]?.cwd).toBe("/workspace/root");
  });
});

describe("buildCiSteps", () => {
  it("orders the gates and omits boundaries without a rules file", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-ci-order-"));
    try {
      const ctx = makeContext({ cwd: dir, project: { ...defaultProject, root: dir } });
      expect(buildCiSteps(ctx).map((step) => step.name)).toEqual([
        "audit",
        "typecheck",
        "lint",
        "deadcode",
        "duplication",
        "smells",
        "coverage",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("Biome config fallback", () => {
  it("applies the bundled Biome preset when the project has no config", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-biome-fallback-"));
    try {
      const ctx = makeContext({ cwd: dir, project: { ...defaultProject, root: dir } });
      const args = buildLintSteps(ctx)[0]?.args ?? [];
      expect(args.some((arg) => arg.startsWith("--config-path="))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses the project's own Biome config when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-biome-own-"));
    try {
      writeFileSync(join(dir, "biome.json"), "{}");
      const ctx = makeContext({ cwd: dir, project: { ...defaultProject, root: dir } });
      const args = buildLintSteps(ctx)[0]?.args ?? [];
      expect(args.some((arg) => arg.startsWith("--config-path="))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("report artifacts", () => {
  it("adds biome sarif output when reporting is enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-report-flags-"));
    try {
      const ctx = makeContext({
        cwd: dir,
        project: { ...defaultProject, root: dir },
        config: { report: { enabled: true } },
      });
      const args = buildLintSteps(ctx)[0]?.args ?? [];
      expect(args).toContain("--reporter=sarif");
      expect(args.some((arg) => arg.startsWith("--reporter-file="))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds junit output to coverage when reporting is enabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-report-cov-"));
    try {
      const ctx = makeContext({
        cwd: dir,
        project: { ...defaultProject, root: dir },
        config: { report: { enabled: true } },
      });
      const args = buildCoverageStep(ctx)[0]?.args ?? [];
      expect(args).toContain("--reporter=junit");
      expect(args.some((arg) => arg.startsWith("--outputFile.junit="))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("splits boundaries into an artifact step and a gate", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-report-bounds-"));
    try {
      writeFileSync(join(dir, ".dependency-cruiser.cjs"), "module.exports = {};");
      const ctx = makeContext({
        cwd: dir,
        project: { ...defaultProject, root: dir },
        config: {
          boundaries: { rulesPath: ".dependency-cruiser.cjs" },
          report: { enabled: true },
        },
      });
      const steps = buildBoundariesStep(ctx);
      expect(steps.map((step) => step.name)).toEqual(["boundaries:report", "boundaries"]);
      expect(steps[0]?.args).toContain("json");
      expect(steps[1]?.args).toContain("err");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("omits artifacts when reporting is disabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-report-off-"));
    try {
      const ctx = makeContext({
        cwd: dir,
        project: { ...defaultProject, root: dir },
        config: { report: { enabled: false } },
      });
      expect(buildLintSteps(ctx)[0]?.args ?? []).not.toContain("--reporter=sarif");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildStylesStep", () => {
  it("skips when not applicable", () => {
    expect(buildStylesStep(makeContext())).toEqual([]);
  });

  it("uses the project stylelint config when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-styles-own-"));
    try {
      const ctx = makeContext({
        cwd: dir,
        project: { ...defaultProject, root: dir, hasStylelintConfig: true },
      });
      const args = buildStylesStep(ctx)[0]?.args ?? [];
      expect(args).toContain("--allow-empty-input");
      expect(args).toContain("**/*.css");
      expect(args.some((arg) => arg.startsWith("--config="))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies the shipped tailwind preset and scss syntax when detected", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-styles-tw-"));
    try {
      const ctx = makeContext({
        cwd: dir,
        project: { ...defaultProject, root: dir, hasTailwind: true, hasScss: true },
      });
      const args = buildStylesStep(ctx)[0]?.args ?? [];
      expect(args.some((arg) => arg.includes("stylelint/stylelint.tailwind.json"))).toBe(true);
      expect(args).toContain("--custom-syntax=postcss-scss");
      expect(args).toContain("**/*.scss");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("honours styles.enabled=false", () => {
    const ctx = makeContext({
      project: { ...defaultProject, hasTailwind: true },
      config: { styles: { enabled: false } },
    });
    expect(buildStylesStep(ctx)).toEqual([]);
  });
});

describe("buildPreCommitSteps", () => {
  it("runs only staged lint for the default biome formatter", () => {
    const steps = buildPreCommitSteps(makeContext(), { stagedTypeScript: false });
    expect(steps.map((step) => step.name)).toEqual(["lint"]);
    expect(steps[0]?.args).toContain("--staged");
  });

  it("adds staged format when the formatter is prettier", () => {
    const repo = mkdtempSync(join(tmpdir(), "qa-precommit-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      writeFileSync(join(repo, "a.ts"), "export const x = 1;\n");
      execFileSync("git", ["add", "a.ts"], { cwd: repo });

      const steps = buildPreCommitSteps(
        makeContext({
          cwd: repo,
          project: { ...defaultProject, root: repo },
          config: { formatter: "prettier" },
        }),
        { stagedTypeScript: false }
      );

      expect(steps.map((step) => step.name)).toEqual(["lint", "format"]);
      expect(steps[1]?.args).toContain("a.ts");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("adds a full typecheck only when TypeScript is staged", () => {
    const steps = buildPreCommitSteps(makeContext(), { stagedTypeScript: true });
    expect(steps.map((step) => step.name)).toEqual(["lint", "typecheck"]);
    expect(steps[1]?.args).toContain("--noEmit");
  });
});

describe("hasStagedTypeScript", () => {
  it("is false outside a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "qa-staged-"));
    try {
      expect(hasStagedTypeScript(dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
