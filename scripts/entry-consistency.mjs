#!/usr/bin/env node
/**
 * 入口一致性门禁：
 * - /help 中列出的命令必须存在于 COMMANDS（含别名）
 * - 所有非 unsupported 主命令必须出现在 /help
 * Usage: node scripts/entry-consistency.mjs
 */
import { COMMANDS } from "../dist/commands/index.js";
import { HELP_LINES } from "../dist/commands/help.js";

const registered = new Set();
for (const command of COMMANDS) {
  registered.add(command.name);
  for (const alias of command.aliases ?? []) registered.add(alias);
}

const helpCommands = new Set();
for (const line of HELP_LINES) {
  for (const match of String(line).matchAll(/(^|[\s|,])(\/[a-zA-Z0-9_\-\u4e00-\u9fff]+)/g)) {
    helpCommands.add(match[2]);
  }
}

const missingInHelp = COMMANDS
  .filter((command) => command.availability !== "unsupported")
  .map((command) => command.name)
  .filter((name) => !helpCommands.has(name));

const runtimeCommands = new Set(["/queue", "/队列", "/name"]);
const unknownInHelp = [...helpCommands].filter((name) => !registered.has(name) && !runtimeCommands.has(name));

if (missingInHelp.length > 0 || unknownInHelp.length > 0) {
  if (missingInHelp.length > 0) console.error("commands missing from /help:", missingInHelp.join(", "));
  if (unknownInHelp.length > 0) console.error("unknown commands in /help:", unknownInHelp.join(", "));
  process.exit(1);
}

console.log(`entry consistency ok: ${COMMANDS.length} commands, ${helpCommands.size} help entries`);
