import test from "node:test";
import assert from "node:assert/strict";

import { buildToolRegistry } from "../../dist/tools/index.js";

test("tool registry: static disable takes effect", () => {
  const tools = buildToolRegistry({
    staticEnabled: {
      bash: false,
      read: true,
    },
  });
  const names = tools.map((t) => t.name);
  assert.equal(names.includes("bash"), false);
  assert.equal(names.includes("read"), true);
});

test("tool registry: runtime/channel layers are merged with overwrite-by-name", () => {
  const tools = buildToolRegistry({
    runtimeInjected: [{ name: "foo", description: "runtime", parameters: {} }],
    channelContextual: [{ name: "foo", description: "channel", parameters: {} }],
  });
  const foo = tools.find((t) => t.name === "foo");
  assert.ok(foo);
  assert.equal(foo.description, "channel");
});

test("tool registry: includes subtask tool in static layer", () => {
  const tools = buildToolRegistry();
  const names = tools.map((t) => t.name);
  assert.equal(names.includes("subtask"), true);
});
