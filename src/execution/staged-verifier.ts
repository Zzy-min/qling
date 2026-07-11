export type VerificationStageName = "syntax_type" | "affected_tests" | "configured" | "full_gate";

export interface VerificationStage {
  name: VerificationStageName;
  command: string;
}

export interface VerificationResult {
  ok: boolean;
  stages: Array<{ name: VerificationStageName; command: string; code: number; durationMs: number }>;
  failedStage?: VerificationStageName;
  failingTests: string[];
  stdout: string;
  stderr: string;
}

export class StagedVerifier {
  private readonly execute: (command: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  private readonly now: () => number;

  constructor(options: {
    execute: (command: string) => Promise<{ code: number; stdout: string; stderr: string }>;
    now?: () => number;
  }) {
    this.execute = options.execute;
    this.now = options.now ?? (() => Date.now());
  }

  async run(stages: VerificationStage[]): Promise<VerificationResult> {
    const completed: VerificationResult["stages"] = [];
    for (const stage of stages) {
      const startedAt = this.now();
      const result = await this.execute(stage.command);
      completed.push({ name: stage.name, command: stage.command, code: result.code, durationMs: this.now() - startedAt });
      if (result.code !== 0) {
        return {
          ok: false,
          stages: completed,
          failedStage: stage.name,
          failingTests: extractFailingTests(`${result.stdout}\n${result.stderr}`),
          stdout: result.stdout,
          stderr: result.stderr,
        };
      }
    }
    return { ok: true, stages: completed, failingTests: [], stdout: "", stderr: "" };
  }
}

export function extractFailingTests(output: string): string[] {
  const names = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const fail = line.match(/^\s*FAIL\s+(.+?)\s*$/i);
    if (fail) names.add(fail[1].trim());
    const nodeTest = line.match(/^\s*not ok\s+\d+\s+-\s+(.+?)\s*$/i);
    if (nodeTest) names.add(nodeTest[1].trim());
  }
  return [...names].sort();
}
