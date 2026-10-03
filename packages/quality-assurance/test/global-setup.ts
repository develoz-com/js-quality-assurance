import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Builds dist once, before any test file starts. Several tests spawn the
 * compiled CLI as a child process. They used to rebuild dist themselves, and
 * tsc rewrites files in place, so one file could spawn the CLI while another
 * file's build had a module half-written. Vitest runs files in parallel, so
 * that race was real but timing-dependent.
 */
export default function setup(): void {
  execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.build.json"], {
    cwd: packageRoot,
    stdio: "pipe",
  });
  for (const expected of ["dist/cli.js", "dist/pipeline/lock.js"]) {
    if (!existsSync(join(packageRoot, expected))) {
      throw new Error(`global setup: expected ${expected} after build`);
    }
  }
}
