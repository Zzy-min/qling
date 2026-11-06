import { inspectActiveConnection, logoutProfile } from "../auth/service.js";
import { loadQlingConfig } from "../config.js";
import { runConnectionWizard } from "./setup.js";
export async function runAuthCli(mode: "login" | "logout" | "auth", args: string[], stateDir: string,
  write: (line: string) => void = line => process.stdout.write(line + "\n")): Promise<number> {
  if (mode === "auth") {
    if (args.length !== 1 || args[0] !== "status") { write("用法: qling auth status"); return 2; }
    const status = await inspectActiveConnection(stateDir);
    write(status.profile ? `Provider: ${status.profile.provider}\n方式: ${status.profile.method}\n本地状态: ${status.status}${status.needsRefresh ? "（下次请求需要刷新）" : ""}${status.expiresAt ? `\n到期: ${new Date(status.expiresAt).toISOString()}` : ""}\n模型: ${status.profile.model}\n推理: 尚未验证（仅检查本地状态）` : "未选择 Qling 连接。运行 qling setup 或 qling login。");
    return 0;
  }
  if (mode === "logout") {
    if (args.length > 1) { write("用法: qling logout [provider]"); return 2; }
    await logoutProfile(stateDir, args[0] === "grok" ? "grok-account" : args[0]);
    write("已退出匹配的 Qling 账号或解除连接；账号选择元数据保留以防自动 API 计费回退，Grok 全局登录保持不变。"); return 0;
  }
  if (args.length > 1 || (args[0] && !["chatgpt", "grok"].includes(args[0]))) { write("用法: qling login [chatgpt|grok]"); return 2; }
  const result = await runConnectionWizard({ stateDir, account: args[0] as "chatgpt" | "grok" | undefined });
  if (result.status === "skipped") { write("登录需要交互式终端；请在终端运行 qling login [chatgpt|grok]。"); return 1; }
  return result.status === "saved" ? 0 : 1;
}
export async function resolveSavedLlmSession(stateDir: string) {
  const { config } = await loadQlingConfig({ fileStateDir: stateDir });
  return { provider: config.llm.provider, endpoint: config.llm.endpoint, model: config.llm.model, apiKey: config.llm.api_key };
}
