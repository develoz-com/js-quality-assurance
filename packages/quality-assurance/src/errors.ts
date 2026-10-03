import type { LockHolder } from "./pipeline/lock.js";

export class RunLockBusyError extends Error {
  readonly holder: LockHolder;

  constructor(holder: LockHolder) {
    super(
      `qa: pipeline locked by PID ${holder.pid} (running '${holder.command}' since ${new Date(
        holder.timestamp
      ).toISOString()}). Exiting.`
    );
    this.name = "RunLockBusyError";
    this.holder = holder;
  }
}
