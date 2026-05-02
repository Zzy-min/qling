import { AgentLoop } from "../agent-loop.js";

export interface SlashCommand {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  execute: (args: string[], agentLoop: AgentLoop) => Promise<void>;
}
