import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  buildTestStep,
  buildTypecheckStep,
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
};

function makeContext(overrides: Partial<BuildContext> = {}): BuildContext {
  return {
    cwd: packageRoot,
    config: {},
    project: defaultProject,
    coverage: resolveCoverage({ env: {}, config: {} }),
    ...overrides,
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
    expect(buildBoundariesStep(makeContext())).toEqual([]);
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
  it("builds npm audit at high by default", () => {
    const steps = buildAuditStep(makeContext());
    expect(steps[0]?.command).toBe("npm");
    expect(steps[0]?.args).toEqual(["audit", "--audit-level", "high"]);
  });

  it("honours package manager and level", () => {
    const steps = buildAuditStep(
      makeContext({
        project: { ...defaultProject, packageManager: "pnpm" },
        config: { audit: { level: "critical" } },
      })
    );
    expect(steps[0]?.command).toBe("pnpm");
    expect(steps[0]?.args).toEqual(["audit", "--audit-level", "critical"]);
  });

  it("runs yarn audit bare", () => {
    const steps = buildAuditStep(
      makeContext({ project: { ...defaultProject, packageManager: "yarn" } })
    );
    expect(steps[0]?.args).toEqual(["audit"]);
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
  it("orders audit, typecheck, lint, deadcode, duplication, smells, coverage", () => {
    expect(buildCiSteps(makeContext()).map((step) => step.name)).toEqual([
      "audit",
      "typecheck",
      "lint",
      "deadcode",
      "duplication",
      "smells",
      "coverage",
    ]);
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

describe("buildPreCommitSteps", () => {
  it("runs only staged lint for the default biome formatter", () => {
    const steps = buildPreCommitSteps(makeContext(), { stagedTypeScript: false });
    expect(steps.map((step) => step.name)).toEqual(["lint"]);
    expect(steps[0]?.args).toContain("--staged");
  });

  it("adds staged format when the formatter is prettier", () => {
    const steps = buildPreCommitSteps(makeContext({ config: { formatter: "prettier" } }), {
      stagedTypeScript: false,
    });
    expect(steps.map((step) => step.name)).toEqual(["lint", "format"]);
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
