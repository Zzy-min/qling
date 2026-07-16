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
import { alwaysApproveCommand, modeCommand } from "./mode.js";
import { themeCommand } from "./theme.js";
import { sandboxCommand } from "./sandbox.js";
import { statuslineCommand } from "./statusline.js";
import { doctorCommand } from "./doctor.js";
import { contextCommand } from "./context.js";
import { recapCommand } from "./recap.js";
import { privacyCommand } from "./privacy.js";
import { shortcutsCommand } from "./shortcuts.js";
import { exportCommand } from "./export.js";
import { exportsCommand } from "./exports.js";
import { memoryCommand } from "./memory.js";
import { repomapCommand } from "./repomap.js";
import { dreamCommand } from "./dream.js";
import { distillCommand } from "./distill.js";
import { knowledgeCommand } from "./knowledge.js";
import { connectCommand } from "./connect.js";
import { storageCommand } from "./storage.js";
import { mcpCommand } from "./mcp.js";
import { hooksCommand } from "./hooks.js";
import { agentsCommand } from "./agents.js";
import { missionCommand } from "./mission.js";
import { verifyCommand } from "./verify.js";
import { recoverCommand } from "./recover.js";
import { traceCommand } from "./trace.js";
import { SlashCommandContext, withDefaultWriters } from "./runtime.js";
import { formatFocusedHelp } from "../help-topics.js";
import { formatLocalGuidancePanel } from "../cli/guidance-panel.js";
import { getLocalizedText } from "../i18n/index.js";
import {
  commitCommand,
  copyCommand,
  diffCommand,
  expandCommand,
  initCommand,
  modelCommand,
  planCommand,
  unavailableClaudeCommands,
  usageCommand,
} from "./claude-style.js";
import { rewindCommand } from "./rewind.js";
import { forkCommand } from "./fork.js";
import { getSkillDirs, runSkill } from "../tools/skill.js";
import { listSkills } from "../skills/registry.js";
import { parseFrontmatter } from "../skills/registry.js";
import {
  isNonExecutableSkill,
  shouldSkipSkillDirName,
} from "../skills/skill-catalog.js";
import { existsSync, readdirSync, readFileSync, type Dirent } from "fs";
import { basename, join } from "path";

export const COMMANDS: SlashCommand[] = [
  helpCommand,
  initCommand,
  sessionsCommand,
  resumeCommand,
  rewindCommand,
  forkCommand,
  checkpointCommand,
  clearCommand,
  statusCommand,
  usageCommand,
  modelCommand,
  planCommand,
  modeCommand,
  alwaysApproveCommand,
  themeCommand,
  sandboxCommand,
  expandCommand,
  diffCommand,
  commitCommand,
  copyCommand,
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
  repomapCommand,
  knowledgeCommand,
  connectCommand,
  verifyCommand,
  recoverCommand,
  traceCommand,
  dreamCommand,
  distillCommand,
  storageCommand,
  agentsCommand,
  missionCommand,
  mcpCommand,
  hooksCommand,
  doctorCommand,
  contextCommand,
  ...unavailableClaudeCommands,
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
  category: string;
  argumentHint: string;
  availability: "local" | "unsupported";
  examples: string[];
  claudeCompatibleName?: string;
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

/**
 * 斜杠命令目录（命令面板 / 补全 / 切换器共用）。
 * 默认排除 Claude 不可用占位命令与归档 skill。
 */
export function getSlashCommandCatalog(options?: {
  includeUnsupported?: boolean;
}): SlashCommandCatalogItem[] {
  const includeUnsupported = options?.includeUnsupported === true;
  const commands = COMMANDS.map((command) => ({
    name: command.name,
    aliases: [...(command.aliases ?? [])],
    description: command.description,
    usage: command.usage,
    category: command.category ?? "local",
    argumentHint: command.argumentHint ?? "",
    availability: command.availability ?? "local",
    examples: [...(command.examples ?? [])],
    claudeCompatibleName: command.claudeCompatibleName,
  })).filter(
    (item) => includeUnsupported || item.availability !== "unsupported"
  );
  return [...commands, ...getLocalSkillCatalogItems(commands)];
}

function getSlashCommandNames(item: SlashCommandCatalogItem): string[] {
  return [item.name, ...item.aliases];
}

/**
 * 将本地 skill 暴露为 /name 快捷入口。
 * - 跳过 archive / templates / examples
 * - 跳过占位/模板 skill
 * - 使用 frontmatter 真实描述（不再统一「本地 skill 直接调用」）
 */
function getLocalSkillCatalogItems(existing: SlashCommandCatalogItem[]): SlashCommandCatalogItem[] {
  const builtinNames = new Set(existing.flatMap(getSlashCommandNames).map(normalizeSlashName));
  const items: SlashCommandCatalogItem[] = [];
  const seen = new Set<string>();

  for (const dir of getSkillDirs()) {
    if (!existsSync(dir)) continue;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldSkipSkillDirName(entry.name)) continue;
        const skillMd = join(dir, entry.name, "SKILL.md");
        const indexMd = join(dir, entry.name, "index.md");
        const filePath = existsSync(skillMd)
          ? skillMd
          : existsSync(indexMd)
            ? indexMd
            : "";
        if (!filePath) continue;
        let meta;
        try {
          meta = parseFrontmatter(readFileSync(filePath, "utf8"), filePath);
        } catch {
          continue;
        }
        if (isNonExecutableSkill(meta)) continue;
        const normalized = normalizeSlashName(meta.name || entry.name);
        if (!normalized || builtinNames.has(normalized) || seen.has(normalized)) continue;
        seen.add(normalized);
        const slashName = `/${meta.name || entry.name}`;
        items.push({
          name: slashName,
          aliases: [],
          description: (meta.description || `技能 ${meta.name}`).slice(0, 80),
          usage: slashName,
          category: "skill",
          argumentHint: "",
          availability: "local",
          examples: [slashName, `/skill ${meta.name || entry.name}`],
        });
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        const skillName = basename(entry.name, ".md");
        const normalized = normalizeSlashName(skillName);
        if (!normalized || normalized === "skill" || normalized === "index") continue;
        if (shouldSkipSkillDirName(normalized)) continue;
        if (builtinNames.has(normalized) || seen.has(normalized)) continue;
        const filePath = join(dir, entry.name);
        let meta;
        try {
          meta = parseFrontmatter(readFileSync(filePath, "utf8"), filePath);
        } catch {
          continue;
        }
        if (isNonExecutableSkill(meta)) continue;
        seen.add(normalized);
        const slashName = `/${meta.name || skillName}`;
        items.push({
          name: slashName,
          aliases: [],
          description: (meta.description || `技能 ${meta.name || skillName}`).slice(0, 80),
          usage: slashName,
          category: "skill",
          argumentHint: "",
          availability: "local",
          examples: [slashName, `/skill ${meta.name || skillName}`],
        });
      }
    }
  }
  return items;
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

export function formatSlashCommandPanel(prefix: string, selectedIndex = 0, width = 80, limit = 8): string[] {
  const t = getLocalizedText();
  const matches = findSlashCompletion(prefix, limit);
  const safeWidth = Math.max(30, Math.floor(Number(width) || 80));
  if (matches.length > 0) {
    const lines = matches.map((item, index) => {
      const marker = index === selectedIndex ? ">" : " ";
      const args = item.argumentHint ? ` ${item.argumentHint}` : "";
      const cat = item.category || "local";
      const cnCat = getChineseCategory(cat, t);
      return truncatePanelLine(`${marker} ${item.name}${args}  [${cnCat}]  ${item.description}`, safeWidth);
    });
    const panelHint = t.tui?.hints?.panel || "提示    : ↑/↓ 选择 · Tab 补全 · Enter 执行当前输入";
    lines.push(truncatePanelLine(panelHint, safeWidth));
    return lines;
  }

  const hint = findExactSlashCommandForArgumentHint(prefix);
  if (!hint) return [];
  const arg = hint.argumentHint || hint.usage.replace(hint.name, "").trim();
  const contHint = t.tui?.hints?.continueInput || "提示    : 继续输入参数 · Enter 执行当前输入";
  return [
    truncatePanelLine(`参数    : ${hint.name}${arg ? ` ${arg}` : ""}    ${hint.description}`, safeWidth),
    truncatePanelLine(contHint, safeWidth),
  ];
}

function truncatePanelLine(line: string, width: number): string {
  return line.length > width ? line.slice(0, width - 1) + "…" : line;
}

function getChineseCategory(cat: string, t: any): string {
  const cats = (t.tui?.slashCategories as Record<string, string>) || {};
  const map: Record<string, string> = {
    local: cats.common || "常用",
    core: cats.common || "常用",
    session: cats.context || "上下文",
    git: cats.git || "Git",
    memory: cats.memory || "记忆",
    cloud: cats.connectors || "连接器",
    skill: cats.advanced || "高级",
  };
  return cats[cat] || map[cat] || cat;
}

export function formatGroupedSlashPanel(width = 80): string[] {
  const t = getLocalizedText();
  // 仅可执行命令；不含 Claude 占位、不含归档 skill
  const catalog = getSlashCommandCatalog({ includeUnsupported: false });
  const safeWidth = Math.max(30, Math.floor(Number(width) || 80));
  const groups: Record<string, SlashCommandCatalogItem[]> = {};

  for (const item of catalog) {
    const cat = item.category || "local";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }

  const order = ["local", "core", "session", "git", "memory", "cloud", "skill"];
  const lines: string[] = [];
  const panelHint =
    t.tui?.hints?.panel ||
    "提示    : 继续输入过滤 · Enter 打开命令切换器 · Tab 补全";
  const merged: Record<string, SlashCommandCatalogItem[]> = {};

  for (const key of order) {
    const items = groups[key];
    if (!items || items.length === 0) continue;
    const cn = getChineseCategory(key, t);
    if (!merged[cn]) merged[cn] = [];
    merged[cn].push(...items);
  }

  lines.push(truncatePanelLine("轻灵命令 (可执行 · Enter 打开切换器)", safeWidth));
  lines.push(truncatePanelLine("─".repeat(Math.min(safeWidth, 60)), safeWidth));

  for (const [cn, items] of Object.entries(merged)) {
    lines.push(truncatePanelLine(`【${cn}】 ${items.length}`, safeWidth));
    for (const item of items.slice(0, 4)) {
      const args = item.argumentHint ? ` ${item.argumentHint}` : "";
      const desc =
        item.description.length > 28
          ? item.description.slice(0, 26) + "…"
          : item.description;
      lines.push(truncatePanelLine(`  ${item.name}${args}  ${desc}`, safeWidth));
    }
    if (items.length > 4) {
      lines.push(truncatePanelLine(`  … 另 ${items.length - 4} 条 · Enter 切换器全览`, safeWidth));
    }
  }

  lines.push(truncatePanelLine("─".repeat(Math.min(safeWidth, 60)), safeWidth));
  lines.push(truncatePanelLine(panelHint, safeWidth));
  return lines;
}

/** 供 TUI 命令切换器：扁平可执行命令列表 */
export function listExecutableSlashCommandsForPicker(): Array<{
  id: string;
  label: string;
  description: string;
  argumentHint: string;
}> {
  return getSlashCommandCatalog({ includeUnsupported: false }).map((item) => ({
    id: item.name,
    label: item.name,
    description: item.description,
    argumentHint: item.argumentHint || "",
  }));
}

function findExactSlashCommandForArgumentHint(input: string): SlashCommandCatalogItem | null {
  if (!input.startsWith("/") || !/\s$/.test(input)) return null;
  const cmd = input.trim().split(/\s+/)[0] ?? "";
  if (!cmd) return null;
  return getSlashCommandCatalog().find((item) => getSlashCommandNames(item).some((name) => name === cmd)) ?? null;
}

export function formatUnknownSlashCommandMessage(cmdName: string): string {
  const t = getLocalizedText();
  const suggestions = findSlashCommandSuggestions(cmdName);
  const normalizedInput = cmdName.replace(/^\/+/, "");
  if (!suggestions.length) {
    return formatLocalGuidancePanel({
      title: `❌ 未知指令: ${cmdName}。`,
      reason: "当前输入不是已注册的 slash 命令。",
      next: "查看全部: /help",
      example: `普通输入: ${normalizedInput}`,
      boundary: t.boundaries.slashCorrection,
    });
  }

  const commands = suggestions.map((suggestion) => suggestion.command).join(", ");
  const primary = suggestions[0];
  return formatLocalGuidancePanel({
    title: `❌ 未知指令: ${cmdName}。`,
    reason: "输入看起来像 slash 命令，但没有精确命中命令目录。",
    next: `你是不是想用: ${commands}；可执行: ${primary.command}`,
    example: `查看用法: /help ${primary.topic}；普通输入: ${normalizedInput}`,
    boundary: t.boundaries.slashCorrection,
  });
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

  if (await tryRunDirectSkill(cmdName, args, context)) {
    return true;
  }

  if (hasHelpFlag) {
    writeFocusedSlashHelp(normalizeSlashName(cmdName), context);
    return true;
  }

  context.writeError(formatUnknownSlashCommandMessage(cmdName));
  return true;
}

/**
 * Grok 对齐：`/skill-name args…` 直接加载 skill 正文（与 slash 菜单项一致）。
 * args 以注释块附在输出前，便于模型按参数执行（对标 Grok /commit fix the build）。
 */
async function tryRunDirectSkill(
  cmdName: string,
  args: string[],
  context: SlashCommandContext
): Promise<boolean> {
  const name = normalizeSlashName(cmdName);
  if (!/^[a-z0-9_@/-]+$/i.test(name)) return false;
  // 归档目录名禁止当 skill 执行
  if (shouldSkipSkillDirName(name)) return false;
  const skills = await listSkills(getSkillDirs());
  const hit = skills.find((skill) => normalizeSlashName(skill.name) === name);
  if (!hit || isNonExecutableSkill(hit)) return false;

  const result = await runSkill({ name });
  if (result.is_error) {
    context.writeError(result.output);
    return true;
  }
  const argText = args.join(" ").trim();
  if (argText) {
    context.writeLine(`📎 skill 参数: ${argText}`);
    context.writeLine("");
  }
  context.writeLine(result.output);
  return true;
}
