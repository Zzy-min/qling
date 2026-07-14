import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRuntimeMetaSection,
  findLastUserMessageContent,
  heuristicReflect,
} from "../../dist/agent/system-prompt.js";

test("findLastUserMessageContent returns last user text", () => {
  assert.equal(
    findLastUserMessageContent([
      { role: "user", content: "one" },
      { role: "assistant", content: "a" },
      { role: "user", content: "two" },
    ]),
    "two"
  );
  assert.equal(findLastUserMessageContent([]), "");
});

test("buildRuntimeMetaSection includes provider and paths", () => {
  const text = buildRuntimeMetaSection({
    provider: "deepseek",
    endpoint: "https://api.example.com",
    workspaceDir: "C:\\repo",
    fileCacheDir: "C:\\cache",
    fileStateDir: "C:\\state",
    runtimeRootDir: "C:\\qling",
  });
  assert.match(text, /Runtime Meta/);
  assert.match(text, /deepseek/);
  assert.match(text, /C:\\repo/);
});

test("heuristicReflect warns on destructive shell", () => {
  const warn = heuristicReflect({
    id: "1",
    name: "bash",
    arguments: { cmd: "rm -rf /tmp/x" },
  });
  assert.equal(warn.decision, "warn");
  const ok = heuristicReflect({
    id: "2",
    name: "bash",
    arguments: { cmd: "npm test" },
  });
  assert.equal(ok.decision, "proceed");
});
