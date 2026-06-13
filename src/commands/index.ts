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

export interface SlashCommandCatalogItem {
  name: string;
  aliases: string[];
  description: string;
  usage: string;
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

export function getSlashCommandCatalog(): SlashCommandCatalogItem[] {
  return COMMANDS.map((command) => ({
    name: command.name,
    aliases: [...(command.aliases ?? [])],
    description: command.description,
    usage: command.usage,
  }));
}

function getSlashCommandNames(item: SlashCommandCatalogItem): string[] {
  return [item.name, ...item.aliases];
}

export function findSlashCommandSuggestions(input: string, limit = 3): SlashSuggestion[] {
  const suggestions: SlashSuggestion[] = [];
  for (const item of getSlashCommandCatalog()) {
    for (const name of getSlashCommandNames(item)) {
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

export function findSlashCompletion(prefix: string, limit = 5): SlashCommandCatalogItem[] {
  const rawPrefix = prefix.trim();
  if (!rawPrefix.startsWith("/") || /\s/.test(rawPrefix)) return [];
  const normalizedPrefix = normalizeSlashName(rawPrefix);
  const catalog = getSlashCommandCatalog();
  const matched = catalog
    .map((item, index) => {
      const names = getSlashCommandNames(item);
      const bestScore = names.reduce((best, name) => {
        const normalizedName = normalizeSlashName(name);
        if (!normalizedName) return best;
        if (!normalizedPrefix) return Math.max(best, 1);
        if (normalizedName === normalizedPrefix) return Math.max(best, 100);
        if (normalizedName.startsWith(normalizedPrefix)) {
          return Math.max(best, 80 - Math.abs(normalizedName.length - normalizedPrefix.length));
        }
        return best;
      }, 0);
      return { item, index, score: bestScore };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);

  return matched.slice(0, Math.max(0, limit));
}

export function formatSlashCompletionHint(prefix: string, width = 80): string[] {
  const matches = findSlashCompletion(prefix, 5);
  if (matches.length === 0) return [];
  const commandList = matches.map((item) => item.name).join("  ");
  const line = `补全    : ${commandList}    Tab 补全`;
  const safeWidth = Math.max(30, Math.floor(Number(width) || 80));
  return [line.length > safeWidth ? line.slice(0, safeWidth - 1) + "…" : line];
}

export function formatUnknownSlashCommandMessage(cmdName: string): string {
  const suggestions = findSlashCommandSuggestions(cmdName);
  const normalizedInput = cmdName.replace(/^\/+/, "");
  if (!suggestions.length) {
    return [
      `❌ 未知指令: ${cmdName}。`,
      "查看全部 : /help",
      `普通输入 : ${normalizedInput}`,
      "说明     : 这是本地纠错提示，不调用模型、不执行建议命令。",
    ].join("\n");
  }

  const commands = suggestions.map((suggestion) => suggestion.command).join(", ");
  const primary = suggestions[0];
  return [
    `❌ 未知指令: ${cmdName}。`,
    `你是不是想用: ${commands}`,
    `可执行   : ${primary.command}`,
    `查看用法 : /help ${primary.topic}`,
    `普通输入 : ${normalizedInput}`,
    "说明     : 这是本地纠错提示，不调用模型、不自动执行建议命令。",
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
