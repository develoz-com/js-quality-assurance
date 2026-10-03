export type StepStatus = "passed" | "failed" | "skipped";

export interface PipelineStep {
  /** Human-readable step label shown in reports. */
  name: string;
  /** Executable to spawn. Never run through a shell. */
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  /** When present and falsy, the step is skipped. */
  condition?: () => boolean | Promise<boolean>;
  /** Record the failure but keep running subsequent steps. */
  continueOnError?: boolean;
  /** Eligible for the fast pre-commit path. */
  fast?: boolean;
}

export interface StepResult {
  name: string;
  status: StepStatus;
  exitCode: number;
  durationMs: number;
  signal: NodeJS.Signals | null;
  stdout?: string;
  stderr?: string;
}

export interface PipelineResult {
  ok: boolean;
  exitCode: number;
  steps: StepResult[];
}

export interface PipelineReporter {
  onStepStart?(step: PipelineStep, index: number, total: number): void;
  onStepEnd?(result: StepResult, index: number, total: number): void;
}
