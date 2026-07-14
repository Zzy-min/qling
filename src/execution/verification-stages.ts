// ============================================================
// 统一验证阶段解析：写操作恢复闭环只走 StagedVerifier
// ============================================================

import type { VerificationStage, VerificationStageName } from "./staged-verifier.js";

const KNOWN_STAGE_NAMES = new Set<VerificationStageName>([
  "syntax_type",
  "affected_tests",
  "configured",
  "full_gate",
]);

/**
 * Resolve ordered verification stages for write recovery.
 *
 * Sources (later stages append; configured command always last when set):
 * 1. `QLING_VERIFY_STAGES` — JSON array of `{name,command}` or `name=command;name=command`
 * 2. Convenience env: `QLING_VERIFY_TYPECHECK_CMD`, `QLING_VERIFY_TEST_CMD`, `QLING_VERIFY_FULL_CMD`
 * 3. Session/workspace `configuredCommand` from `/verify set` or `.qling-verify.json`
 */
export function resolveVerificationStages(options: {
  configuredCommand?: string | null;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): VerificationStage[] {
  const env = options.env ?? process.env;
  const stages: VerificationStage[] = [];
  const seen = new Set<string>();

  const push = (name: VerificationStageName, command: string | undefined) => {
    const cmd = String(command ?? "").trim();
    if (!cmd) return;
    const key = `${name}::${cmd}`;
    if (seen.has(key)) return;
    seen.add(key);
    stages.push({ name, command: cmd });
  };

  const rawStages = String(env.QLING_VERIFY_STAGES ?? "").trim();
  if (rawStages) {
    for (const stage of parseVerifyStagesEnv(rawStages)) {
      push(stage.name, stage.command);
    }
  }

  push("syntax_type", env.QLING_VERIFY_TYPECHECK_CMD);
  push("affected_tests", env.QLING_VERIFY_TEST_CMD);
  push("full_gate", env.QLING_VERIFY_FULL_CMD);
  push("configured", options.configuredCommand ?? undefined);

  return stages;
}

export function parseVerifyStagesEnv(raw: string): VerificationStage[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as Array<{ name?: string; command?: string }>;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((item) => normalizeStage(item?.name, item?.command))
        .filter((item): item is VerificationStage => item !== null);
    } catch {
      return [];
    }
  }

  // name=command;name=command  or  name:command|name:command
  const parts = trimmed.split(/[;|]/).map((part) => part.trim()).filter(Boolean);
  const stages: VerificationStage[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    const colon = part.indexOf(":");
    let name = "";
    let command = "";
    if (eq > 0) {
      name = part.slice(0, eq).trim();
      command = part.slice(eq + 1).trim();
    } else if (colon > 0) {
      name = part.slice(0, colon).trim();
      command = part.slice(colon + 1).trim();
    } else {
      command = part;
      name = "configured";
    }
    const stage = normalizeStage(name, command);
    if (stage) stages.push(stage);
  }
  return stages;
}

function normalizeStage(nameRaw: unknown, commandRaw: unknown): VerificationStage | null {
  const command = String(commandRaw ?? "").trim();
  if (!command) return null;
  const name = String(nameRaw ?? "configured").trim().toLowerCase().replace(/-/g, "_");
  const mapped: VerificationStageName = KNOWN_STAGE_NAMES.has(name as VerificationStageName)
    ? (name as VerificationStageName)
    : "configured";
  return { name: mapped, command };
}

/** Summarize stages for doctor / status output. */
export function formatVerificationStagesSummary(stages: VerificationStage[]): string {
  if (stages.length === 0) return "none（写操作后无命令验证；仅 advisory 规则提示）";
  return stages.map((stage) => `${stage.name}=${stage.command}`).join(" → ");
}
