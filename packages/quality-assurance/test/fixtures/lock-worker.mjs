import { RunLock } from "../../dist/pipeline/lock.js";

const [lockDir, holdMs] = process.argv.slice(2);

const lock = new RunLock({ lockDir });
try {
  lock.tryAcquire("concurrency-test");
} catch {
  process.exit(2);
}

await new Promise((resolve) => setTimeout(resolve, Number(holdMs)));
lock.release();
process.exit(0);
