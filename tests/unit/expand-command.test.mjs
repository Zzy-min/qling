import test from "node:test";
import assert from "node:assert/strict";

import { expandCommand } from "../../dist/commands/claude-style.js";

test("/expand toggles tool output expansion when context provides toolOutput", async () => {
  let expanded = false;
  const lines = [];
  const context = {
    writeLine: (s) => lines.push(String(s)),
    writeError: (s) => lines.push(String(s)),
    toolOutput: {
      get expanded() {
        return expanded;
      },
      setExpanded: (v) => {
        expanded = Boolean(v);
      },
      toggle: () => {
        expanded = !expanded;
        return expanded;
      },
    },
  };

  await expandCommand.execute([], context);
  assert.equal(expanded, true);
  assert.match(lines.join("\n"), /展开/);

  lines.length = 0;
  await expandCommand.execute(["off"], context);
  assert.equal(expanded, false);
  assert.match(lines.join("\n"), /折叠/);

  lines.length = 0;
  await expandCommand.execute(["status"], context);
  assert.match(lines.join("\n"), /折叠|展开/);
});

test("/expand degrades when no TUI toolOutput bridge", async () => {
  const lines = [];
  await expandCommand.execute([], {
    writeLine: (s) => lines.push(String(s)),
    writeError: (s) => lines.push(String(s)),
  });
  assert.match(lines.join("\n"), /Ctrl\+O|未挂载/);
});
