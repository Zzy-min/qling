import { SlashCommand } from "./types.js";
import { helpCommand } from "./help.js";
import { clearCommand } from "./clear.js";
import { statusCommand } from "./status.js";
import { skillCommand } from "./skill.js";
import { dashboardCommand } from "./dashboard.js";
import { configCommand } from "./config.js";
import { detachCommand } from "./detach.js";
import { compactCommand } from "./compact.js";
import { goalCommand } from "./goal.js";
import { loopCommand } from "./loop.js";
import { tasksCommand } from "./tasks.js";
import { sessionsCommand } from "./sessions.js";
import { resumeCommand } from "./resume.js";
import { checkpointCommand } from "./checkpoint.js";
import { permissionsCommand } from "./permissions.js";
import { statuslineCommand } from "./statusline.js";
import { doctorCommand } from "./doctor.js";
import { contextCommand } from "./context.js";
import { recapCommand } from "./recap.js";
import { privacyCommand } from "./privacy.js";
import { shortcutsCommand } from "./shortcuts.js";
import { exportCommand } from "./export.js";
import { exportsCommand } from "./exports.js";
import { memoryCommand } from "./memory.js";
import { dreamCommand } from "./dream.js";
import { distillCommand } from "./distill.js";
import { storageCommand } from "./storage.js";
import { mcpCommand } from "./mcp.js";
import { hooksCommand } from "./hooks.js";
import { agentsCommand } from "./agents.js";
import { missionCommand } from "./mission.js";
import { SlashCommandContext, withDefaultWriters } from "./runtime.js";
import { formatFocusedHelp } from "../help-topics.js";

export const COMMANDS: SlashCommand[] = [
  helpCommand,
  sessionsCommand,
  resumeCommand,
  checkpointCommand,
  clearCommand,
  statusCommand,
  skillCommand,
  dashboardCommand,
  configCommand,
  detachCommand,
  compactCommand,
  goalCommand,
  loopCommand,
  tasksCommand,
  permissionsCommand,
  statuslineCommand,
  recapCommand,
  privacyCommand,
  shortcutsCommand,
  exportCommand,
  exportsCommand,
  memoryCommand,
  dreamCommand,
  distillCommand,
  storageCommand,
  agentsCommand,
  missionCommand,
  mcpCommand,
  hooksCommand,
  doctorCommand,
  contextCommand,
];

function isCommandContext(value: unknown): value is Partial<SlashCommandContext> & { agentLoop: Record<string, unknown> } {
  return Boolean(value && typeof value === "object" && "agentLoop" in (value as Record<string, unknown>));
}

interface SlashSuggestion {
  command: string;
  topic: string;
  score: number;
}

function normalizeSlashName(value: string): string {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

function isSlashHelpFlag(value: string): boolean {
  return value === "--help" || value === "-h";
}

function writeFocusedSlashHelp(topic: string, context: SlashCommandContext): void {
  for (const line of formatFocusedHelp(topic, { surface: "slash" })) {
    context.writeLine(line);
  }
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 0; i < left.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < right.length; j++) {
      const substitutionCost = left[i] === right[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + substitutionCost
      );
    }
    previous = current;
  }
  return previous[right.length];
}

function scoreSlashCandidate(input: string, candidate: string): number | null {
  const normalizedInput = normalizeSlashName(input);
  const normalizedCandidate = normalizeSlashName(candidate);
  if (!normalizedInput || !normalizedCandidate) return null;
  if (normalizedCandidate === normalizedInput) return 100;
  if (normalizedCandidate.startsWith(normalizedInput) || normalizedInput.startsWith(normalizedCandidate)) {
    return 80 - Math.abs(normalizedCandidate.length - normalizedInput.length);
  }
  if (normalizedCandidate.includes(normalizedInput) || normalizedInput.includes(normalizedCandidate)) {
    return 60 - Math.abs(normalizedCandidate.length - normalizedInput.length);
  }

  const distance = levenshteinDistance(normalizedInput, normalizedCandidate);
  const maxLength = Math.max(normalizedInput.length, normalizedCandidate.length);
  const allowedDistance = maxLength <= 5 ? 1 : 2;
  if (distance > allowedDistance) return null;
  const endingBoost = normalizedInput.endsWith("s") && normalizedCandidate.endsWith("s") ? 12 : 0;
  return 45 - distance * 8 - Math.abs(normalizedCandidate.length - normalizedInput.length) + endingBoost;
}

export function findSlashCommandSuggestions(input: string, limit = 3): SlashSuggestion[] {
  const suggestions: SlashSuggestion[] = [];
  for (const command of COMMANDS) {
    const names = [command.name, ...(command.aliases ?? [])];
    for (const name of names) {
      const score = scoreSlashCandidate(input, name);
      if (score === null || score < 20) continue;
      suggestions.push({
        command: name,
        topic: normalizeSlashName(name),
        score,
      });
    }
  }

  return suggestions
    .sort((left, right) =>
      right.score - left.score
      || normalizeSlashName(right.command).length - normalizeSlashName(left.command).length
      || left.command.localeCompare(right.command)
    )
    .filter((suggestion, index, sorted) => sorted.findIndex((item) => item.command === suggestion.command) === index)
    .slice(0, limit);
}

export function formatUnknownSlashCommandMessage(cmdName: string): string {
  const suggestions = findSlashCommandSuggestions(cmdName);
  if (!suggestions.length) {
    return `❌ 未知指令: ${cmdName}。输入 /help 查看可用指令。`;
  }

  const commands = suggestions.map((suggestion) => suggestion.command).join(", ");
  const primary = suggestions[0];
  return [
    `❌ 未知指令: ${cmdName}。`,
    `你是不是想用: ${commands}`,
    `查看用法: /help ${primary.topic}`,
  ].join("\n");
}

export async function handleSlashCommand(
  input: string,
  contextOrAgentLoop: SlashCommandContext | Record<string, any>
): Promise<boolean> {
  if (!input.startsWith("/")) return false;
  const context = isCommandContext(contextOrAgentLoop)
    ? withDefaultWriters(contextOrAgentLoop)
    : withDefaultWriters({ agentLoop: contextOrAgentLoop });

  const parts = input.split(/\s+/);
  const cmdName = parts[0].toLowerCase();
  const args = parts.slice(1);
  const hasHelpFlag = args.some(isSlashHelpFlag);

  const cmd = COMMANDS.find(c => c.name === cmdName || c.aliases?.includes(cmdName));
  if (cmd) {
    if (cmd.name !== helpCommand.name && hasHelpFlag) {
      writeFocusedSlashHelp(normalizeSlashName(cmd.name), context);
      return true;
    }
    await cmd.execute(args, context);
    return true;
  }

  if (hasHelpFlag) {
    writeFocusedSlashHelp(normalizeSlashName(cmdName), context);
    return true;
  }

  context.writeError(formatUnknownSlashCommandMessage(cmdName));
  return true;
}
