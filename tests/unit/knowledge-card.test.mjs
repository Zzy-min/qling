import test from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";
import { knowledgeCommand } from "../../dist/commands/knowledge.js";

test("knowledge overview renders a single rounded info card", async () => {
  const lines = [];
  const ctx = {
    writeLine: (line = "") => lines.push(line),
    writeError: (line = "") => lines.push(line),
  };
  await knowledgeCommand.execute([], ctx);

  const cardLines = lines.filter((line) => /^[╭│╰]/.test(line));
  assert.ok(cardLines.length >= 6);
  const widths = [...new Set(cardLines.map((line) => stringWidth(line)))];
  assert.equal(widths.length, 1, `card widths drifted: ${widths.join(", ")}`);
  assert.match(cardLines[0], /轻灵知识库/);
  assert.match(cardLines.join("\n"), /用法/);
  assert.match(cardLines.join("\n"), /隐私边界/);
});
