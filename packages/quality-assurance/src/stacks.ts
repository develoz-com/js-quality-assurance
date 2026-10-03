import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StackKind, TestRunnerKind } from "./config.js";

export type PackageManagerKind = "npm" | "pnpm" | "yarn" | "bun";

const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"];

export interface ProjectInfo {
  root: string;
  stack: StackKind;
  packageManager: PackageManagerKind;
  hasPackageJson: boolean;
  hasTypeScript: boolean;
  hasJsTests: boolean;
  hasTailwind: boolean;
  hasScss: boolean;
  hasStylelintConfig: boolean;
  testRunner: TestRunnerKind;
}

function readPackageJson(cwd: string): Record<string, unknown> | null {
  const path = join(cwd, "package.json");
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Rails apps pull Tailwind from the `tailwindcss-rails` gem rather than a
 * package.json dependency, so the npm dependency check alone misses them.
 */
function railsUsesTailwind(dir: string): boolean {
  if (existsSync(join(dir, "app/assets/tailwind"))) {
    return true;
  }
  const gemfile = join(dir, "Gemfile");
  if (!existsSync(gemfile)) {
    return false;
  }
  try {
    return /^\s*gem\s+["']tailwindcss-rails["']/m.test(readFileSync(gemfile, "utf8"));
  } catch {
    return false;
  }
}

function dependencyNames(pkg: Record<string, unknown>): Set<string> {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const group = pkg[field];
    if (typeof group === "object" && group !== null) {
      for (const name of Object.keys(group)) {
        names.add(name);
      }
    }
  }
  return names;
}

export function detectStack(cwd: string): StackKind {
  const pkg = readPackageJson(cwd);
  const hasNextConfig = [
    "next.config.js",
    "next.config.mjs",
    "next.config.ts",
    "next.config.cjs",
  ].some((name) => existsSync(join(cwd, name)));
  if (!(pkg || hasNextConfig)) {
    return "node";
  }
  const deps = pkg ? dependencyNames(pkg) : new Set<string>();
  if (hasNextConfig || deps.has("next")) {
    return "next";
  }
  if (deps.has("react")) {
    return "react";
  }
  return "node";
}

export function detectPackageManager(cwd: string): PackageManagerKind {
  if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(cwd, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}

export function detectProject(cwd: string): ProjectInfo {
  const root = findWorkspaceRoot(cwd);
  const rootPkg = readPackageJson(root);
  const cwdPkg = readPackageJson(cwd);
  const deps = cwdPkg ? dependencyNames(cwdPkg) : new Set<string>();

  return {
    root,
    stack: detectStack(cwd),
    packageManager: detectPackageManager(root),
    hasPackageJson: rootPkg !== null,
    hasTypeScript:
      existsSync(join(cwd, "tsconfig.json")) || existsSync(join(root, "tsconfig.json")),
    hasJsTests: hasJsTests(cwd) || hasJsTests(root),
    hasTailwind: deps.has("tailwindcss") || railsUsesTailwind(cwd) || railsUsesTailwind(root),
    hasScss: deps.has("sass") || deps.has("node-sass") || deps.has("postcss-scss"),
    hasStylelintConfig: hasStylelintConfig(cwd) || hasStylelintConfig(root),
    testRunner: detectTestRunner(cwd, deps),
  };
}

const TEST_DIRS = ["test", "tests", "__tests__", "src"] as const;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
// An actual import or require of the module, not any mention of the string.
const BUN_TEST_IMPORT =
  /^\s*(?:import\b[^\n]*\bfrom\s*|import\s*|(?:const|let|var)\b[^\n]*=\s*require\()\s*["']bun:test["']/m;

/**
 * Whether the project has JavaScript/TypeScript tests at all. Vitest ships as
 * an auto-installed peer, so tool presence alone cannot gate the test and
 * coverage steps.
 */
function hasJsTests(dir: string): boolean {
  for (const name of TEST_DIRS) {
    const folder = join(dir, name);
    if (!existsSync(folder)) {
      continue;
    }
    try {
      if (readdirSync(folder).some((entry) => TEST_FILE.test(entry))) {
        return true;
      }
    } catch {
      // An unreadable test directory cannot vote either way.
    }
  }
  return false;
}

function usesBunTest(dir: string): boolean {
  for (const name of TEST_DIRS) {
    const folder = join(dir, name);
    if (!existsSync(folder)) {
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(folder);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!TEST_FILE.test(entry)) {
        continue;
      }
      try {
        if (BUN_TEST_IMPORT.test(readFileSync(join(folder, entry), "utf8"))) {
          return true;
        }
      } catch {
        // An unreadable test file cannot vote either way.
      }
    }
  }
  return false;
}

/**
 * Bun when the tests import `bun:test`, or the project has a bunfig.toml and no
 * vitest dependency. Vitest otherwise.
 */
function detectTestRunner(cwd: string, deps: ReadonlySet<string>): TestRunnerKind {
  if (usesBunTest(cwd)) {
    return "bun";
  }
  if (existsSync(join(cwd, "bunfig.toml")) && !deps.has("vitest")) {
    return "bun";
  }
  return "vitest";
}

const STYLELINT_CONFIG_FILES = [
  ".stylelintrc",
  ".stylelintrc.json",
  ".stylelintrc.js",
  ".stylelintrc.cjs",
  ".stylelintrc.mjs",
  "stylelint.config.js",
  "stylelint.config.cjs",
  "stylelint.config.mjs",
] as const;

function hasStylelintConfig(dir: string): boolean {
  if (STYLELINT_CONFIG_FILES.some((name) => existsSync(join(dir, name)))) {
    return true;
  }
  const pkg = readPackageJson(dir);
  return typeof pkg?.stylelint === "object" && pkg.stylelint !== null;
}

/**
 * Walks up to the workspace root: the nearest directory holding a lockfile,
 * falling back to the nearest package.json. Keeps monorepo commands (notably
 * `audit`) pointed at the lockfile rather than the package directory.
 */
export function findWorkspaceRoot(cwd: string): string {
  let dir = cwd;
  let nearestPackageJson: string | null = null;

  while (true) {
    if (LOCKFILES.some((name) => existsSync(join(dir, name)))) {
      return dir;
    }
    if (nearestPackageJson === null && existsSync(join(dir, "package.json"))) {
      nearestPackageJson = dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return nearestPackageJson ?? cwd;
    }
    dir = parent;
  }
}

/** Staged files with the given extensions, for tools without a native --staged flag. */
export function listStagedFiles(cwd: string, extensions: readonly string[]): string[] {
  try {
    const output = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const suffix = new RegExp(`\\.(${extensions.join("|")})$`);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && suffix.test(line));
  } catch {
    return [];
  }
}
