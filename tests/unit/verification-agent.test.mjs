import test from "node:test";
import assert from "node:assert/strict";

import { VerificationAgent } from "../../dist/pipeline/verification.js";

test("VerificationAgent reuses the injected provider client and current model", async () => {
  const previous = process.env.QLING_VERIFY_LLM;
  const previousFetch = globalThis.fetch;
  process.env.QLING_VERIFY_LLM = "1";
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "PASS\n一行说明：legacy hardcoded path" } }] }),
  });
  const calls = [];
  const client = {
    chatCompletions: async (input) => {
      calls.push(input);
      return { content: "PASS\n一行说明：provider-neutral" };
    },
  };
  try {
    const verifier = new VerificationAgent(client, "custom-model");
    const result = await verifier.verify("write", "done", "ok");
    assert.equal(result.verdict, "PASS");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, "custom-model");
    assert.equal(calls[0].tools.length, 0);
  } finally {
    globalThis.fetch = previousFetch;
    if (previous === undefined) delete process.env.QLING_VERIFY_LLM;
    else process.env.QLING_VERIFY_LLM = previous;
  }
});
