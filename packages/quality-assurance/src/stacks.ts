import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StackKind } from "./config.js";

export type PackageManagerKind = "npm" | "pnpm" | "yarn" | "bun";

const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"];

export interface ProjectInfo {
  root: string;
  stack: StackKind;
  packageManager: PackageManagerKind;
  hasPackageJson: boolean;
  hasTypeScript: boolean;
  hasTailwind: boolean;
  hasScss: boolean;
  hasStylelintConfig: boolean;
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
    hasTailwind: deps.has("tailwindcss"),
    hasScss: deps.has("sass") || deps.has("node-sass") || deps.has("postcss-scss"),
    hasStylelintConfig: hasStylelintConfig(cwd) || hasStylelintConfig(root),
  };
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
