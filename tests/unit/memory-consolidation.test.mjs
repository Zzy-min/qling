import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { consolidateMemoriesLLM } from "../../dist/memory/consolidation.js";

// Direct property mutation of axios since it is a mutable object
const originalPost = axios.post;
let mockAxiosPost = null;

axios.post = async (url, data, config) => {
  if (mockAxiosPost) {
    return mockAxiosPost(url, data, config);
  }
  return originalPost(url, data, config);
};

test("consolidateMemoriesLLM - no key fallback returns ADD for non-duplicates", async () => {
  const existing = [{ id: "mem_1", content: "existing fact", source: "test", createdAt: 1, importance: 0.5 }];
  const candidates = ["existing fact", "new unique fact"];

  const ops = await consolidateMemoriesLLM(candidates, existing, {
    apiKey: "",
    endpoint: "http://mock-api.com",
    model: "mock-model",
  });

  assert.equal(ops.length, 1);
  assert.equal(ops[0].action, "ADD");
  assert.equal(ops[0].fact, "new unique fact");
});

test("consolidateMemoriesLLM - JSON parse failure fallback", async () => {
  mockAxiosPost = async () => {
    return {
      data: {
        choices: [
          {
            message: {
              content: "This is invalid JSON output from the LLM.",
            },
          },
        ],
      },
    };
  };

  const existing = [{ id: "mem_1", content: "existing fact", source: "test", createdAt: 1, importance: 0.5 }];
  const candidates = ["new unique fact"];

  const ops = await consolidateMemoriesLLM(candidates, existing, {
    apiKey: "test-key",
    endpoint: "http://mock-api.com",
    model: "mock-model",
  });

  // Fallback behavior on JSON parsing error should be standard ADD
  assert.equal(ops.length, 1);
  assert.equal(ops[0].action, "ADD");
  assert.equal(ops[0].fact, "new unique fact");
});

test("consolidateMemoriesLLM - successful mock LLM operations mapping", async () => {
  mockAxiosPost = async () => {
    return {
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify([
                { action: "ADD", fact: "new fact" },
                { action: "UPDATE", targetId: "mem_1", fact: "updated existing fact", reason: "more current" },
                { action: "DELETE", targetId: "mem_2", reason: "deprecated" },
              ]),
            },
          },
        ],
      },
    };
  };

  const existing = [
    { id: "mem_1", content: "old existing fact", source: "test", createdAt: 1, importance: 0.5 },
    { id: "mem_2", content: "deprecated fact", source: "test", createdAt: 2, importance: 0.5 },
  ];
  const candidates = ["new fact", "updated existing fact"];

  const ops = await consolidateMemoriesLLM(candidates, existing, {
    apiKey: "test-key",
    endpoint: "http://mock-api.com",
    model: "mock-model",
  });

  assert.equal(ops.length, 3);
  assert.equal(ops[0].action, "ADD");
  assert.equal(ops[0].fact, "new fact");

  assert.equal(ops[1].action, "UPDATE");
  assert.equal(ops[1].targetId, "mem_1");
  assert.equal(ops[1].fact, "updated existing fact");

  assert.equal(ops[2].action, "DELETE");
  assert.equal(ops[2].targetId, "mem_2");
});
