import { SlashCommand } from "./types.js";

export const configCommand: SlashCommand = {
  name: "/config",
  aliases: ["/settings"],
  description: "查看当前生效配置",
  usage: "/config",
  execute: async (_args, context) => {
    context.writeLine("");
    context.writeLine("⚙️ 【当前环境配置】");
    context.writeLine("-----------------------------------------");
    context.writeLine(`Provider   : ${process.env.QLING_LLM_PROVIDER || "未设置"}`);
    context.writeLine(`Model      : ${process.env.QLING_LLM_MODEL || "未设置"}`);
    context.writeLine(`Endpoint   : ${process.env.QLING_LLM_ENDPOINT || "默认"}`);
    context.writeLine(`Workspace  : ${context.workspaceDir || process.cwd()}`);
    context.writeLine(`Vision     : ${process.env.QLING_FEATURES_VISION_TOOL === "true" ? "开启" : "关闭"}`);
    context.writeLine(`Memory     : ${process.env.QLING_FEATURES_SEMANTIC_MEMORY === "true" ? "语义" : "传统"}`);
    context.writeLine(`Isolation  : ${process.env.QLING_AGENTS_ISOLATION_MODE || "worktree"}`);
    context.writeLine(`RequireGit : ${process.env.QLING_AGENTS_ISOLATION_REQUIRE_GIT || "true"}`);
    context.writeLine(`NonGit     : ${process.env.QLING_AGENTS_ISOLATION_NON_GIT_POLICY || "warn"}`);
    context.writeLine(`MCP expose : ${process.env.QLING_MCP_TOOL_EXPOSURE || "eager"}`);
    context.writeLine(`MCP output : ${process.env.QLING_MCP_MAX_OUTPUT_BYTES || "20480"} bytes`);
    context.writeLine(`Anchored   : ${process.env.QLING_EXPERIMENTAL_ANCHORED_EDIT === "true" ? "实验开启" : "关闭"}`);
    context.writeLine(`JSON Hooks : ${process.env.QLING_JSON_HOOKS_ENABLED === "true" ? "开启" : "关闭"}`);
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
