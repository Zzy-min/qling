import test from "node:test";
import assert from "node:assert/strict";

import { quitCommand } from "../../dist/commands/quit.js";
import { handleSlashCommand } from "../../dist/commands/index.js";
import { formatFocusedHelp } from "../../dist/help-topics.js";

test("quit command exposes /exit alias and asks the host to exit gracefully", async () => {
  assert.equal(quitCommand.name, "/quit");
  assert.ok(quitCommand.aliases?.includes("/exit"));
  assert.ok(quitCommand.aliases?.includes("/q"));

  let exited = 0;
  await quitCommand.execute([], {
    agentLoop: {},
    requestExit: async () => {
      exited += 1;
    },
    writeLine: () => {},
    writeError: () => {},
  });
  assert.equal(exited, 1);
});

test("/exit dispatches through the slash alias and requests a graceful exit", async () => {
  let exited = 0;
  const handled = await handleSlashCommand("/exit", {
    agentLoop: {},
    requestExit: async () => {
      exited += 1;
    },
    writeLine: () => {},
    writeError: () => {},
  });
  assert.equal(handled, true);
  assert.equal(exited, 1);
});

test("/help quit documents the exit aliases", () => {
  const text = formatFocusedHelp("quit", { surface: "slash" }).join("\n");
  assert.match(text, /退出 qling/);
  assert.match(text, /\/quit/);
  assert.match(text, /\/exit/);
});