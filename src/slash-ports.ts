// ============================================================
// Slash ports — agent-runtime / presentation 依赖的抽象，避免直接 import cli/commands
// ============================================================

import type { SlashCommandContext } from "./slash-context.js";

export type SlashCommandHandler = (
  input: string,
  context: SlashCommandContext | Record<string, any>
) => Promise<boolean>;

export interface SlashCatalogItem {
  name: string;
  description?: string;
  aliases?: string[];
}

export type FindSlashCompletion = (prefix: string, limit?: number) => SlashCatalogItem[];
export type FormatSlashPanel = (prefix: string, selectedIndex?: number, width?: number, limit?: number) => string[];
export type FormatGroupedSlashPanel = (width?: number) => string[];

export interface SlashUiPorts {
  findSlashCompletion: FindSlashCompletion;
  formatSlashCommandPanel: FormatSlashPanel;
  formatGroupedSlashPanel: FormatGroupedSlashPanel;
}

export interface SlashRuntimePorts {
  handleSlashCommand: SlashCommandHandler;
  ui?: SlashUiPorts;
}

/** 由 cli 入口注入；未注入时 runtime 使用动态 import 回退（不形成静态分层边） */
let installedPorts: SlashRuntimePorts | null = null;

export function installSlashPorts(ports: SlashRuntimePorts): void {
  installedPorts = ports;
}

export function getInstalledSlashPorts(): SlashRuntimePorts | null {
  return installedPorts;
}

export async function resolveSlashHandler(
  override?: SlashCommandHandler
): Promise<SlashCommandHandler> {
  if (override) return override;
  if (installedPorts?.handleSlashCommand) return installedPorts.handleSlashCommand;
  const mod = await import("./commands/index.js");
  return mod.handleSlashCommand;
}

export async function resolveSlashUiPorts(override?: SlashUiPorts): Promise<SlashUiPorts> {
  if (override) return override;
  if (installedPorts?.ui) return installedPorts.ui;
  const mod = await import("./commands/index.js");
  return {
    findSlashCompletion: mod.findSlashCompletion,
    formatSlashCommandPanel: mod.formatSlashCommandPanel,
    formatGroupedSlashPanel: mod.formatGroupedSlashPanel,
  };
}
