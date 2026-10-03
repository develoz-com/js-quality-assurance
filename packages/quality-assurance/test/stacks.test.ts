import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectPackageManager,
  detectProject,
  detectStack,
  listStagedFiles,
} from "../src/stacks.js";

const dirs: string[] = [];

function fixture(pkg?: Record<string, unknown>, extraFiles: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "qa-stack-"));
  dirs.push(dir);
  if (pkg) {
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  }
  for (const name of extraFiles) {
    const path = join(dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "");
  }
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("detectStack", () => {
  it("defaults to node without a package.json", () => {
    expect(detectStack(fixture())).toBe("node");
  });

  it("detects next from a dependency", () => {
    expect(detectStack(fixture({ dependencies: { next: "16.0.0", react: "19.0.0" } }))).toBe(
      "next"
    );
  });

  it("detects next from next.config", () => {
    expect(detectStack(fixture({ dependencies: { react: "19.0.0" } }, ["next.config.mjs"]))).toBe(
      "next"
    );
  });

  it("detects react without next", () => {
    expect(detectStack(fixture({ dependencies: { react: "19.0.0" } }))).toBe("react");
  });

  it("detects node for a plain typescript project", () => {
    expect(detectStack(fixture({ devDependencies: { typescript: "5.9.0" } }))).toBe("node");
  });
});

describe("detectPackageManager", () => {
  it("reads the lockfile", () => {
    expect(detectPackageManager(fixture({}, ["pnpm-lock.yaml"]))).toBe("pnpm");
    expect(detectPackageManager(fixture({}, ["yarn.lock"]))).toBe("yarn");
    expect(detectPackageManager(fixture({}, ["bun.lockb"]))).toBe("bun");
    expect(detectPackageManager(fixture({}, ["package-lock.json"]))).toBe("npm");
  });

  it("defaults to npm without a lockfile", () => {
    expect(detectPackageManager(fixture({}))).toBe("npm");
  });
});

describe("detectProject", () => {
  it("reports typescript and package.json presence", () => {
    const project = detectProject(fixture({ name: "x" }, ["tsconfig.json"]));
    expect(project.hasPackageJson).toBe(true);
    expect(project.hasTypeScript).toBe(true);
    expect(project.stack).toBe("node");
  });

  it("finds the workspace root lockfile from a package directory", () => {
    const root = fixture({ name: "root" }, ["pnpm-lock.yaml"]);
    const packageDir = join(root, "packages", "app");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), JSON.stringify({ name: "app" }));

    const project = detectProject(packageDir);

    expect(project.root).toBe(root);
    expect(project.packageManager).toBe("pnpm");
    expect(project.hasPackageJson).toBe(true);
  });

  it("detects Tailwind from the tailwindcss-rails gem without a package.json", () => {
    const dir = fixture();
    writeFileSync(join(dir, "Gemfile"), 'gem "tailwindcss-rails"\n');
    const project = detectProject(dir);
    expect(project.hasTailwind).toBe(true);
    expect(project.hasPackageJson).toBe(false);
  });

  it("detects Tailwind from app/assets/tailwind", () => {
    const dir = fixture();
    mkdirSync(join(dir, "app", "assets", "tailwind"), { recursive: true });
    expect(detectProject(dir).hasTailwind).toBe(true);
  });

  it("reports JS tests from a test directory", () => {
    const dir = fixture();
    mkdirSync(join(dir, "test"), { recursive: true });
    writeFileSync(join(dir, "test", "app.test.ts"), "");
    expect(detectProject(dir).hasJsTests).toBe(true);
  });

  it("reports no JS tests for a plain package", () => {
    expect(detectProject(fixture()).hasJsTests).toBe(false);
  });
});

describe("test runner detection", () => {
  it("defaults to vitest", () => {
    expect(detectProject(fixture({ name: "x" })).testRunner).toBe("vitest");
  });

  it("detects bun from a bun:test import", () => {
    const dir = fixture({ name: "x" }, ["test/a.test.js"]);
    writeFileSync(join(dir, "test", "a.test.js"), 'import { test } from "bun:test"\n');
    expect(detectProject(dir).testRunner).toBe("bun");
  });

  it("detects bun from bunfig.toml when vitest is not a dependency", () => {
    expect(detectProject(fixture({ name: "x" }, ["bunfig.toml"])).testRunner).toBe("bun");
  });

  it("keeps vitest when bunfig.toml exists but vitest is a dependency", () => {
    const dir = fixture({ devDependencies: { vitest: "^5.0.0" } }, ["bunfig.toml"]);
    expect(detectProject(dir).testRunner).toBe("vitest");
  });

  it("does not treat a mere mention of bun:test inside a test file as a bun project", () => {
    const dir = fixture({ name: "x" }, ["test/a.test.js"]);
    writeFileSync(
      join(dir, "test", "a.test.js"),
      'it("detects bun", () => { write(\'import { test } from "bun:test"\') })\n// "bun:test"\n'
    );
    expect(detectProject(dir).testRunner).toBe("vitest");
  });

  it("accepts a require of bun:test", () => {
    const dir = fixture({ name: "x" }, ["test/a.test.js"]);
    writeFileSync(join(dir, "test", "a.test.js"), 'const { test } = require("bun:test")\n');
    expect(detectProject(dir).testRunner).toBe("bun");
  });

  it("ignores non-test files that mention bun:test", () => {
    const dir = fixture({ name: "x" }, ["test/helper.js"]);
    writeFileSync(join(dir, "test", "helper.js"), '// uses "bun:test"\n');
    expect(detectProject(dir).testRunner).toBe("vitest");
  });
});

describe("listStagedFiles", () => {
  it("returns an empty list outside a git repository", () => {
    expect(listStagedFiles(fixture({}), ["ts"])).toEqual([]);
  });
});
