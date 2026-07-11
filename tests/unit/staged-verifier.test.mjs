import test from "node:test";
import assert from "node:assert/strict";

import { StagedVerifier, extractFailingTests } from "../../dist/execution/staged-verifier.js";

test("staged verifier stops at the first failed stage and preserves structured evidence", async () => {
  const calls = [];
  const verifier = new StagedVerifier({
    execute: async (command) => {
      calls.push(command);
      return command === "npm run typecheck"
        ? { code: 1, stdout: "FAIL tests/a.test.ts\nFAIL tests/b.test.ts", stderr: "type error" }
        : { code: 0, stdout: "ok", stderr: "" };
    },
  });
  const result = await verifier.run([
    { name: "syntax_type", command: "npm run typecheck" },
    { name: "affected_tests", command: "npm test" },
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.failedStage, "syntax_type");
  assert.deepEqual(result.failingTests, ["tests/a.test.ts", "tests/b.test.ts"]);
  assert.deepEqual(calls, ["npm run typecheck"]);
});

test("failing test extraction is stable and deduplicated", () => {
  assert.deepEqual(extractFailingTests("FAIL x.test.mjs\nnot ok 2 - build works\nFAIL x.test.mjs"), [
    "build works",
    "x.test.mjs",
  ]);
});
