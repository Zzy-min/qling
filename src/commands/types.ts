import { SlashCommandContext } from "./runtime.js";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  execute: (args: string[], context: SlashCommandContext) => Promise<void>;
}
