import path from "node:path";
import os from "node:os";
import type { SlashCommand } from "./types.js";
import { installLocalPlugin, listLocalPlugins } from "../plugins/local-installer.js";

export const pluginCommand: SlashCommand = {
  name: "/plugin",
  aliases: ["/插件"],
  description: "管理本地签名插件源",
  usage: "/plugin list | install <local-dir> [--allow-unsigned] [--force]",
  category: "skill",
  argumentHint: "list | install <local-dir>",
  examples: ["/plugin list", "/plugin install ./my-plugin"],
  execute: async (args, context) => {
    const parts = Array.isArray(args) ? args.map(String) : String(args ?? "").split(/\s+/);
    const sub = (parts[0] ?? "list").toLowerCase();
    const stateDir = process.env.QLING_FILE_STATE_DIR ?? path.join(context.homeDir ?? os.homedir(), ".qling");
    if (sub === "list") {
      const plugins = await listLocalPlugins(stateDir);
      if (plugins.length === 0) {
        context.writeLine("本地未安装插件。");
        return;
      }
      for (const plugin of plugins) context.writeLine(`- ${plugin.id}@${plugin.version} (${plugin.type})`);
      return;
    }
    if (sub !== "install" || !parts[1]) {
      context.writeError("用法: /plugin list | install <local-dir> [--allow-unsigned] [--force]");
      return;
    }
    const sourceDir = parts[1];
    try {
      const installed = await installLocalPlugin({
        sourceDir: path.resolve(context.workspaceDir ?? process.cwd(), sourceDir),
        stateDir,
        allowUnsigned: parts.includes("--allow-unsigned"),
        force: parts.includes("--force"),
      });
      context.writeLine(`✅ 已安装 ${installed.manifest.id}@${installed.manifest.version}`);
      context.writeLine(`签名: ${installed.signatureVerified ? "verified" : "unsigned-explicit"}`);
      context.writeLine(`位置: ${installed.destination}`);
    } catch (error) {
      context.writeError(`❌ 插件安装失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  },
};
