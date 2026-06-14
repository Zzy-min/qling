import { SlashCommandContext } from "./runtime.js";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  category?: "core" | "session" | "context" | "tools" | "memory" | "agents" | "git" | "skill" | "cloud" | "local";
  argumentHint?: string;
  availability?: "local" | "unsupported";
  examples?: string[];
  claudeCompatibleName?: string;
  execute: (args: string[], context: SlashCommandContext) => Promise<void>;
}
