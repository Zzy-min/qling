import test from "node:test";
import assert from "node:assert/strict";
import {
  filterToolsForRole,
  formatSubAgentReturnContract,
  formatRolesHelp,
  normalizeSubAgentRole,
  isKnownSubAgentRole,
  extractFilesTouchedFromMessages,
  extractEvidenceHints,
  ROLE_DEFINITIONS,
} from "../../dist/agents/roles.js";

test("normalizeSubAgentRole aliases", () => {
  assert.equal(normalizeSubAgentRole("explore"), "explore");
  assert.equal(normalizeSubAgentRole("探索"), "explore");
  assert.equal(normalizeSubAgentRole("审查"), "review");
  assert.equal(normalizeSubAgentRole("implement"), "implement");
  assert.equal(normalizeSubAgentRole(""), "implement");
  assert.equal(normalizeSubAgentRole(undefined), "implement");
});

test("isKnownSubAgentRole rejects garbage", () => {
  assert.equal(isKnownSubAgentRole("explore"), true);
  assert.equal(isKnownSubAgentRole(""), true);
  assert.equal(isKnownSubAgentRole("hacker"), false);
});

test("filterToolsForRole explore is read-only and no nested subtask", () => {
  const pool = [
    { name: "read" },
    { name: "write" },
    { name: "bash" },
    { name: "search" },
    { name: "subtask" },
    { name: "skill" },
    { name: "todo" },
    { name: "patch" },
  ];
  const tools = filterToolsForRole(pool, "explore").map((t) => t.name);
  assert.ok(tools.includes("read"));
  assert.ok(tools.includes("search"));
  assert.ok(tools.includes("skill"));
  assert.ok(!tools.includes("write"));
  assert.ok(!tools.includes("bash"));
  assert.ok(!tools.includes("subtask"));
  assert.ok(!tools.includes("patch"));
  assert.ok(!tools.includes("todo"));
});

test("filterToolsForRole implement allows write/patch/bash but not subtask", () => {
  const pool = [
    { name: "write" },
    { name: "patch" },
    { name: "bash" },
    { name: "subtask" },
    { name: "read" },
  ];
  const tools = filterToolsForRole(pool, "implement").map((t) => t.name);
  assert.ok(tools.includes("write"));
  assert.ok(tools.includes("patch"));
  assert.ok(tools.includes("bash"));
  assert.ok(!tools.includes("subtask"));
});

test("filterToolsForRole review is read-only", () => {
  assert.equal(ROLE_DEFINITIONS.review.canWrite, false);
  const tools = filterToolsForRole(
    [
      { name: "read" },
      { name: "write" },
      { name: "bash" },
      { name: "search" },
      { name: "todo" },
    ],
    "review"
  ).map((t) => t.name);
  assert.deepEqual(tools.sort(), ["read", "search"].sort());
});

test("formatSubAgentReturnContract structure", () => {
  const text = formatSubAgentReturnContract({
    role: "explore",
    success: true,
    durationMs: 42,
    iterations: 3,
    summary: "found entry",
    filesTouched: ["a.ts"],
    evidence: ["line 1"],
    rawOutput: "hello",
  });
  assert.match(text, /【子代理回传契约】/);
  assert.match(text, /role: explore/);
  assert.match(text, /success: true/);
  assert.match(text, /a\.ts/);
  assert.match(text, /hello/);
});

test("extractFilesTouchedFromMessages", () => {
  const files = extractFilesTouchedFromMessages([
    {
      role: "assistant",
      tool_calls: [
        {
          function: {
            name: "write",
            arguments: JSON.stringify({ path: "src/foo.ts" }),
          },
        },
        {
          function: {
            name: "read",
            arguments: JSON.stringify({ path: "src/bar.ts" }),
          },
        },
      ],
    },
  ]);
  assert.deepEqual(files, ["src/foo.ts"]);
});

test("extractEvidenceHints", () => {
  const hints = extractEvidenceHints("all good\nFAIL test_a\nok");
  assert.ok(hints.some((h) => /FAIL/.test(h)));
});

test("formatRolesHelp lists three roles", () => {
  const help = formatRolesHelp();
  assert.match(help, /explore/);
  assert.match(help, /implement/);
  assert.match(help, /review/);
});
