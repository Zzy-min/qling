// Deterministic goal-stall eval. No network. Imports GoalController from dist/.
// Drives an unreachable goal with an injected evaluator and prints:
//   { sameReason, evaluatorThrows }
// each with { autoTurns, finalStatus, goalPreserved, evaluatorErrorTurns, approxTokens }.
// approxTokens = evaluation input characters / 4.
// State files stay under os.tmpdir(); pass --out <file> to also write the JSON.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

delete process.env.QLING_FEATURES_EVIDENCE_GOALS;
delete process.env.QLING_GOAL_STALL_THRESHOLD;
delete process.env.QLING_GOAL_MAX_AUTO_TURNS;

const SAME_REASON = "仍未看到目标证据，缺少标记 NEVER_DONE";
const TRANSCRIPT = [
  "user: 完成这个永远达不成的目标",
  "assistant: 我还在找 NEVER_DONE，目前没有新的证据。",
].join("\n\n");
const MAX_AUTO_TURNS = 12;
const DRIVER_CAP = MAX_AUTO_TURNS + 8;

function goalPreserved(goal) {
  if (!goal || typeof goal.condition !== "string" || goal.condition.length === 0) return false;
  return goal.status !== "cleared" && goal.status !== "canceled";
}

async function drive(label, evaluate) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), `qling-goal-stall-${label}-`));
  let evaluatorErrorTurns = 0;
  let evalChars = 0;
  try {
    const { SessionGoalManager } = await import("../dist/session/session-goal-manager.js");
    const { SessionGoalController } = await import("../dist/session/goal-controller.js");
    const manager = new SessionGoalManager({
      stateDir,
      sessionId: `goal-stall-${label}`,
      clock: () => 1_700_000_000_000,
    });
    const controller = new SessionGoalController({
      manager,
      runner: "session",
      maxAutoTurns: MAX_AUTO_TURNS,
      evaluator: {
        evaluate: async (input) => {
          const condition = typeof input?.condition === "string" ? input.condition : "";
          const transcript = typeof input?.transcript === "string" ? input.transcript : "";
          evalChars += condition.length + transcript.length;
          try {
            return await evaluate(input);
          } catch (error) {
            evaluatorErrorTurns += 1;
            throw error;
          }
        },
      },
    });
    await controller.init();
    await controller.setGoal("永远无法达成的目标：输出标记 NEVER_DONE", { turnCount: 0, tokens: 0 });

    let autoTurns = 0;
    let finalStatus = "active";
    while (autoTurns < DRIVER_CAP) {
      const before = await controller.getGoalStatus();
      if (!before || before.status !== "active") {
        finalStatus = before?.status ?? "missing";
        break;
      }
      autoTurns += 1;
      try {
        await controller.afterTurn({
          transcript: TRANSCRIPT,
          stats: { turnCount: autoTurns, tokens: autoTurns * 100 },
        });
      } catch {
        // Pre-change evaluator throws escape afterTurn. Keep driving while the goal stays active
        // so the budget cap is what stops the loop, matching an unguarded caller.
      }
      const after = await controller.getGoalStatus();
      if (!after || after.status !== "active") {
        finalStatus = after?.status ?? "missing";
        break;
      }
    }

    const goal = await controller.getGoalStatus();
    if (goal && goal.status !== "active") finalStatus = goal.status;
    return {
      autoTurns,
      finalStatus,
      goalPreserved: goalPreserved(goal),
      evaluatorErrorTurns,
      approxTokens: Math.round(evalChars / 4),
    };
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
}

function parseOutPath(argv) {
  const index = argv.indexOf("--out");
  if (index === -1) return null;
  const file = argv[index + 1];
  if (!file || file.startsWith("-")) {
    throw new Error("--out requires a file path");
  }
  return file;
}

const outPath = parseOutPath(process.argv.slice(2));
const report = {
  sameReason: await drive("same-reason", async () => ({ done: false, reason: SAME_REASON })),
  evaluatorThrows: await drive("evaluator-throws", async () => {
    throw new Error("injected evaluator failure");
  }),
};

const json = `${JSON.stringify(report, null, 2)}\n`;
process.stdout.write(json);
if (outPath) {
  await writeFile(outPath, json, "utf8");
}
