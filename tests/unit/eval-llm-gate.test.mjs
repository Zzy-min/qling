import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { buildEvalLlmTasks } from "../../dist/eval/llm-tasks.js";
import { runEvalSuite } from "../../dist/eval/runner.js";

test("eval llm tasks skip when QLING_EVAL_LLM unset", async () => {
  const prev = process.env.QLING_EVAL_LLM;
  delete process.env.QLING_EVAL_LLM;
  try {
    const report = await runEvalSuite({ tasks: buildEvalLlmTasks() });
    assert.equal(report.fail, 0);
    assert.ok(report.skip >= 1);
  } finally {
    if (prev === undefined) delete process.env.QLING_EVAL_LLM;
    else process.env.QLING_EVAL_LLM = prev;
  }
});

async function withLocalLlm(reply, run) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    return await run(`http://127.0.0.1:${address.port}/v1`, requests);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
}

async function runEnabledEval(endpoint) {
  const keys = [
    "QLING_EVAL_LLM",
    "QLING_LLM_API_KEY",
    "QLING_LLM_ENDPOINT",
    "QLING_LLM_MODEL",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.QLING_EVAL_LLM = "1";
    process.env.QLING_LLM_API_KEY = "test-only-key";
    process.env.QLING_LLM_ENDPOINT = endpoint;
    process.env.QLING_LLM_MODEL = "test-model";
    return await runEvalSuite({ tasks: buildEvalLlmTasks() });
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("eval llm enabled path accepts /v1 base URL without duplicating it", async () => {
  await withLocalLlm("QOK", async (endpoint, requests) => {
    const report = await runEnabledEval(endpoint);
    assert.equal(report.fail, 0, JSON.stringify(report.results));
    assert.equal(report.pass, 2);
    assert.deepEqual(requests, ["/v1/chat/completions"]);
  });
});

test("eval llm requires an exact QOK response", async () => {
  await withLocalLlm("QOK extra", async (endpoint) => {
    const report = await runEnabledEval(endpoint);
    assert.equal(report.fail, 1);
    assert.equal(report.results.find((item) => item.id === "llm-chat-connectivity")?.status, "fail");
  });
});
