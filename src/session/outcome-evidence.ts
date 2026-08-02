import { randomUUID } from "node:crypto";

export type EvidenceVerdict = "pass" | "fail" | "partial" | "unknown";
export type EvidenceSource = "command" | "tool" | "filesystem" | "git" | "process" | "http" | "rule" | "llm_judge" | "side_effect";

export interface EvidenceRecord {
  id: string;
  claim: string;
  source: EvidenceSource;
  commandOrTool?: string;
  artifactHash?: string;
  observedAt: number;
  verdict: EvidenceVerdict;
  scope: string;
  deterministic: boolean;
  redacted: boolean;
  sideEffect?: "none" | "workspace" | "process" | "network" | "external";
}

export interface OutcomeContract {
  objective: string;
  deliverables: Array<{ id: string; claim: string; required: boolean; maxAgeMs?: number; allowLlmJudge?: boolean }>;
  prohibitedSideEffects: Array<"workspace" | "process" | "network" | "external">;
  budget: { maxWallClockMs?: number; maxTokens?: number; maxToolCalls?: number; maxFailures?: number };
}

export interface OutcomeEvaluation {
  status: "active" | "achieved" | "blocked";
  reason: string;
  missing: string[];
  failed: string[];
}

export class EvidenceLedger {
  private readonly records: EvidenceRecord[] = [];
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
  }

  record(input: Omit<EvidenceRecord, "id" | "redacted"> & { id?: string; redacted?: boolean }): EvidenceRecord {
    const record: EvidenceRecord = {
      ...input,
      id: input.id ?? `evidence_${randomUUID()}`,
      redacted: input.redacted ?? false,
      observedAt: input.observedAt ?? this.now(),
    };
    this.records.push(record);
    return { ...record };
  }

  list(): EvidenceRecord[] {
    return this.records.map((record) => ({ ...record }));
  }
}

export function evaluateOutcomeContract(
  contract: OutcomeContract,
  evidence: readonly EvidenceRecord[],
  options: { now?: number } = {}
): OutcomeEvaluation {
  const now = options.now ?? Date.now();
  const prohibited = evidence.find((record) =>
    record.source === "side_effect" &&
    record.sideEffect !== undefined &&
    contract.prohibitedSideEffects.includes(record.sideEffect as "workspace" | "process" | "network" | "external")
  );
  if (prohibited) {
    return { status: "blocked", reason: `prohibited side effect observed: ${prohibited.sideEffect}`, missing: [], failed: [prohibited.claim] };
  }

  const missing: string[] = [];
  const failed: string[] = [];
  for (const deliverable of contract.deliverables.filter((item) => item.required)) {
    const matching = evidence
      .filter((record) => record.claim === deliverable.claim)
      .filter((record) => deliverable.maxAgeMs === undefined || now - record.observedAt <= deliverable.maxAgeMs)
      .sort((left, right) => right.observedAt - left.observedAt);
    if (matching.some((record) => record.deterministic && record.verdict === "fail")) {
      failed.push(deliverable.claim);
      continue;
    }
    const passing = matching.some((record) =>
      record.verdict === "pass" &&
      (record.deterministic || (deliverable.allowLlmJudge === true && record.source === "llm_judge"))
    );
    if (!passing) missing.push(deliverable.claim);
  }

  if (failed.length > 0) return { status: "blocked", reason: `deterministic evidence failed: ${failed.join(", ")}`, missing, failed };
  if (missing.length > 0) return { status: "active", reason: `required evidence missing or stale: ${missing.join(", ")}`, missing, failed };
  return { status: "achieved", reason: "all required deliverables have fresh passing evidence", missing, failed };
}
