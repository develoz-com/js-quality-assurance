import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ToolCommand {
  /** Executable to spawn. */
  command: string;
  /** Arguments that must precede the tool's own arguments. */
  argsPrefix: string[];
  /** Resolved absolute path to the tool's entrypoint. */
  binPath: string;
}

export interface ToolSpec {
  /** npm package name. */
  pkg: string;
  /** Binary name exposed by the package. */
  bin: string;
}

const selfRequire = createRequire(import.meta.url);
const selfDir = dirname(fileURLToPath(import.meta.url));

function binPathFromPackage(pkgPath: string, bin: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      bin?: string | Record<string, string>;
    };
    const field = parsed.bin;
    const relative =
      typeof field === "string" ? field : (field?.[bin] ?? Object.values(field ?? {})[0]);
    if (typeof relative !== "string") {
      return null;
    }
    const absolute = join(dirname(pkgPath), relative);
    return existsSync(absolute) ? absolute : null;
  } catch {
    return null;
  }
}

function findPackageJson(resolver: NodeJS.Require, pkg: string): string | null {
  try {
    const direct = resolver.resolve(`${pkg}/package.json`);
    if (existsSync(direct)) {
      return direct;
    }
  } catch {
    // Some packages hide ./package.json behind "exports"; fall through to paths.
  }
  const searchPaths = resolver.resolve.paths(pkg) ?? [];
  for (const base of searchPaths) {
    const candidate = join(base, pkg, "package.json");
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Resolves a tool binary, preferring the copy bundled with @develoz/quality-assurance (so the
 * toolchain ships with the package like the Ruby gem's), then the consuming
 * project's own install.
 */
export function resolveToolBin(spec: ToolSpec, cwd: string): string | null {
  for (const resolver of [selfRequire, createRequire(join(cwd, "package.json"))]) {
    const pkgPath = findPackageJson(resolver, spec.pkg);
    if (pkgPath) {
      const found = binPathFromPackage(pkgPath, spec.bin);
      if (found) {
        return found;
      }
    }
  }

  for (const candidate of [
    join(cwd, "node_modules", ".bin", spec.bin),
    join(cwd, "node_modules", ".bin", spec.pkg),
    join(selfDir, "node_modules", ".bin", spec.bin),
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function toolCommand(spec: ToolSpec, cwd: string): ToolCommand | null {
  const binPath = resolveToolBin(spec, cwd);
  if (!binPath) {
    return null;
  }
  const isScript = /\.(cjs|mjs|js)$/.test(binPath);
  return isScript
    ? { command: process.execPath, argsPrefix: [binPath], binPath }
    : { command: binPath, argsPrefix: [], binPath };
}

export const TOOLS = {
  tsc: { pkg: "typescript", bin: "tsc" },
  vitest: { pkg: "vitest", bin: "vitest" },
  biome: { pkg: "@biomejs/biome", bin: "biome" },
  eslint: { pkg: "eslint", bin: "eslint" },
  prettier: { pkg: "prettier", bin: "prettier" },
  knip: { pkg: "knip", bin: "knip" },
  jscpd: { pkg: "jscpd", bin: "jscpd" },
  depcruise: { pkg: "dependency-cruiser", bin: "depcruise" },
  stylelint: { pkg: "stylelint", bin: "stylelint" },
} as const satisfies Record<string, ToolSpec>;

/**
 * Absolute path to this CLI's executable entrypoint, for self-invoked steps.
 * This is bin/qa.js, not dist/cli.js: the compiled module only exports `main`
 * and does nothing when run directly.
 */
export function selfCliPath(): string {
  return join(selfDir, "..", "bin", "qa.js");
}

export function resolvePackageFile(pkg: string, relative: string, cwd: string): string | null {
  for (const resolver of [selfRequire, createRequire(join(cwd, "package.json"))]) {
    const pkgPath = findPackageJson(resolver, pkg);
    if (pkgPath) {
      const absolute = join(dirname(pkgPath), relative);
      if (existsSync(absolute)) {
        return absolute;
      }
    }
  }
  return null;
}
