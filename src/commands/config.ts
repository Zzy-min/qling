import { SlashCommand } from "./types.js";

export const configCommand: SlashCommand = {
  name: "/config",
  description: "查看当前生效配置",
  usage: "/config",
  execute: async (_args, context) => {
    context.writeLine("");
    context.writeLine("⚙️ 【当前环境配置】");
    context.writeLine("-----------------------------------------");
    context.writeLine(`Provider   : ${process.env.QINGLING_LLM_PROVIDER || "未设置"}`);
    context.writeLine(`Model      : ${process.env.QINGLING_LLM_MODEL || "未设置"}`);
    context.writeLine(`Endpoint   : ${process.env.QINGLING_LLM_ENDPOINT || "默认"}`);
    context.writeLine(`Workspace  : ${context.workspaceDir || process.cwd()}`);
    context.writeLine(`Vision     : ${process.env.QINGLING_FEATURES_VISION_TOOL === "true" ? "开启" : "关闭"}`);
    context.writeLine(`Memory     : ${process.env.QINGLING_FEATURES_SEMANTIC_MEMORY === "true" ? "语义" : "传统"}`);
    context.writeLine(`Isolation  : ${process.env.QINGLING_AGENTS_ISOLATION_MODE || "worktree"}`);
    context.writeLine(`RequireGit : ${process.env.QINGLING_AGENTS_ISOLATION_REQUIRE_GIT || "true"}`);
    context.writeLine(`NonGit     : ${process.env.QINGLING_AGENTS_ISOLATION_NON_GIT_POLICY || "warn"}`);
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
