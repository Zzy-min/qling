import { SlashCommand } from "./types.js";
import { helpCommand } from "./help.js";
import { clearCommand } from "./clear.js";
import { statusCommand } from "./status.js";
import { skillCommand } from "./skill.js";

export const COMMANDS: SlashCommand[] = [
  helpCommand,
  clearCommand,
  statusCommand,
  skillCommand,
];

export async function handleSlashCommand(input: string, agentLoop: any): Promise<boolean> {
  if (!input.startsWith("/")) return false;

  const parts = input.split(/\s+/);
  const cmdName = parts[0].toLowerCase();
  const args = parts.slice(1);

  const cmd = COMMANDS.find(c => c.name === cmdName || c.aliases?.includes(cmdName));
  if (cmd) {
    await cmd.execute(args, agentLoop);
    return true;
  }

  console.error(`❌ 未知指令: ${cmdName}。输入 /help 查看可用指令。`);
  return true;
}
