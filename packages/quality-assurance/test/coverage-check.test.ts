import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { selfCliPath } from "../src/tools.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirs: string[] = [];

function tempProject(lcov: string): { dir: string; lcovPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "qa-cov-check-"));
  dirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", private: true }));
  const lcovPath = join(dir, "lcov.info");
  writeFileSync(lcovPath, lcov);
  return { dir, lcovPath };
}

function run(dir: string, lcovPath: string) {
  // Exactly what the pipeline spawns: node <selfCliPath> coverage:check <lcov>.
  return spawnSync(process.execPath, [selfCliPath(), "coverage:check", lcovPath], {
    cwd: dir,
    encoding: "utf8",
  });
}

beforeAll(() => {
  // selfCliPath() resolves from the compiled output, so it must be built.
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], {
    cwd: packageRoot,
    stdio: "pipe",
  });
}, 120_000);

afterAll(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("coverage:check, run the way the pipeline runs it", () => {
  it("points at an executable entrypoint that exists", () => {
    expect(existsSync(selfCliPath())).toBe(true);
    expect(selfCliPath()).toMatch(/bin[\\/]qa\.js$/);
  });

  it("fails when coverage is below the 100% default", () => {
    const { dir, lcovPath } = tempProject("SF:src/a.js\nFNF:2\nFNH:2\nLF:7\nLH:5\nend_of_record\n");
    const result = run(dir, lcovPath);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("lines 71.43% is below the 100% threshold");
  });

  it("passes when coverage meets the threshold", () => {
    const { dir, lcovPath } = tempProject("SF:src/a.js\nFNF:2\nFNH:2\nLF:7\nLH:7\nend_of_record\n");
    const result = run(dir, lcovPath);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("lines 100.00%");
  });

  it("fails when the lcov report is missing", () => {
    const { dir } = tempProject("");
    const result = run(dir, join(dir, "nope.info"));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no lcov report");
  });

  it("excludes test files from the measured set", () => {
    const { dir, lcovPath } = tempProject(
      [
        "SF:src/a.js\nFNF:1\nFNH:1\nLF:4\nLH:4\nend_of_record",
        "SF:test/helpers.js\nFNF:3\nFNH:0\nLF:10\nLH:0\nend_of_record",
        "",
      ].join("\n")
    );
    expect(run(dir, lcovPath).status).toBe(0);
  });
});
