import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HooksConflictError,
  installHooks,
  NotAGitRepositoryError,
  renderPreCommitScript,
} from "../src/generators/hooks.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "qa-hooks-"));
  dirs.push(dir);
  return dir;
}

function tempRepo(): string {
  const dir = tempDir();
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("renderPreCommitScript", () => {
  it("uses the right runner per package manager", () => {
    expect(renderPreCommitScript("pnpm")).toContain("pnpm exec qa");
    expect(renderPreCommitScript("npm")).toContain("npx --no-install qa");
    expect(renderPreCommitScript("bun")).toContain("bun x qa");
  });

  it("runs staged lint and format, and a full typecheck only when TS is staged", () => {
    const script = renderPreCommitScript("pnpm");
    expect(script).toContain("pre-commit");
    expect(script).not.toContain("typecheck --staged");
  });

  it("tells the user how to bypass", () => {
    expect(renderPreCommitScript("npm")).toContain("git commit --no-verify");
  });
});

describe("installHooks", () => {
  it("rejects a non-git directory", () => {
    expect(() => installHooks(tempDir(), "npm")).toThrow(NotAGitRepositoryError);
  });

  it("writes an executable hook and sets core.hooksPath", () => {
    const repo = tempRepo();

    const result = installHooks(repo, "pnpm");

    expect(result.hooksPath).toBe(".githooks");
    expect(result.changed).toBe(true);
    expect(existsSync(result.hookPath)).toBe(true);
    expect(statSync(result.hookPath).mode & 0o777).toBe(0o755);
    expect(readFileSync(result.hookPath, "utf8")).toContain("pre-commit");

    const configured = execFileSync("git", ["config", "--get", "core.hooksPath"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    expect(configured).toBe(".githooks");
  });

  it("is idempotent", () => {
    const repo = tempRepo();
    installHooks(repo, "npm");
    expect(installHooks(repo, "npm").changed).toBe(false);
  });

  it("refuses to overwrite another hook manager", () => {
    const repo = tempRepo();
    execFileSync("git", ["config", "core.hooksPath", ".husky"], { cwd: repo });
    expect(() => installHooks(repo, "npm")).toThrow(HooksConflictError);
  });
});
