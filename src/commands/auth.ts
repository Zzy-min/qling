import { loadActiveProfile } from "../auth/service.js";
import type { SlashCommand } from "./types.js";
import { runAuthCli, resolveSavedLlmSession } from "../cli/auth.js";
const make = (name: "login" | "logout" | "auth"): SlashCommand => ({
  name: `/${name}`, aliases: name === "auth" ? ["/authstatus"] : undefined, description: name === "login" ? "登录 ChatGPT/Grok 或配置连接" : name === "logout" ? "解除 Qling 当前连接" : "查看本地认证状态（不联网）",
  usage: name === "auth" ? "/auth status" : `/${name} [${name === "login" ? "chatgpt|grok" : "provider"}]`, category: "local", availability: "local",
  execute: async (args, context) => {
    const dir = context.agentLoop.getRuntimeRootDir?.();
    if (!dir) { context.writeError("当前会话没有状态目录。"); return; }
    if (name !== "auth" && (context.isInferenceRunning?.() || ["initializing", "queued", "running", "waiting_approval", "compacting", "verifying", "recovering", "closing"].includes(context.agentLoop.getRuntimeSnapshot?.()?.state))) { context.writeError("请等待当前推理结束后再更改连接。"); return; }
    const run = async () => {
      const previous = name === "logout" ? await loadActiveProfile(dir) : null;
      const code = await runAuthCli(name, name === "auth" && !args.length ? ["status"] : args, dir, context.writeLine);
      if (!code && name === "login") {
        const session = await resolveSavedLlmSession(dir);
        context.agentLoop.applyLlmSession(session);
        await context.onModelChanged?.(session.model);
      }
      // Keep managed identity after logout: subsequent inference fails closed instead of selecting an API key.
      if (!code && name === "logout") {
        if (!args.length || (previous && [previous.provider, previous.provider === "grok-account" ? "grok" : previous.provider].includes(args[0]))) context.agentLoop.applyLlmSession({ apiKey: "" });
        context.writeLine("匹配的当前会话连接已退出。请 /login 后继续；不会切换到 API 计费连接。");
      }
    };
    try {
      if (name === "login") {
        if (!context.withTerminalHandoff) { context.writeError("当前宿主不支持安全终端交接；请在独立终端运行 qling login 后重新打开会话。"); return; }
        await context.withTerminalHandoff(run);
      } else await run();
    } catch { context.writeError("认证操作未完成；旧连接保持不变。请重试 /login 或 qling setup。"); }
  },
});
export const loginCommand = make("login"), logoutCommand = make("logout"), authCommand = make("auth");
