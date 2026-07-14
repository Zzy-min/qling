import test from "node:test";
import assert from "node:assert/strict";

import {
  formatVerificationStagesSummary,
  parseVerifyStagesEnv,
  resolveVerificationStages,
} from "../../dist/execution/verification-stages.js";

test("parseVerifyStagesEnv accepts JSON and semicolon forms", () => {
  assert.deepEqual(
    parseVerifyStagesEnv(
      JSON.stringify([
        { name: "syntax_type", command: "npm run typecheck" },
        { name: "affected_tests", command: "npm test" },
      ])
    ),
    [
      { name: "syntax_type", command: "npm run typecheck" },
      { name: "affected_tests", command: "npm test" },
    ]
  );
  assert.deepEqual(parseVerifyStagesEnv("syntax_type=tsc -b;full_gate=npm run ci:check"), [
    { name: "syntax_type", command: "tsc -b" },
    { name: "full_gate", command: "npm run ci:check" },
  ]);
});

test("resolveVerificationStages merges env helpers and configured command last", () => {
  const stages = resolveVerificationStages({
    configuredCommand: "npm test",
    env: {
      QLING_VERIFY_TYPECHECK_CMD: "npm run typecheck",
      QLING_VERIFY_TEST_CMD: "npm test -- --test-name-pattern unit",
    },
  });
  assert.deepEqual(
    stages.map((s) => s.name),
    ["syntax_type", "affected_tests", "configured"]
  );
  assert.equal(stages.at(-1)?.command, "npm test");
});

test("formatVerificationStagesSummary is honest when empty", () => {
  assert.match(formatVerificationStagesSummary([]), /none/);
  assert.match(
    formatVerificationStagesSummary([{ name: "configured", command: "npm test" }]),
    /configured=npm test/
  );
});
