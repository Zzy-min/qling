import { listPendingAccountModels } from "./auth-models.js";
import { spawn } from "node:child_process";
// ============================================================
// 轻灵 - 首次连接向导
// 账号优先；隐藏输入；连接档案原子激活，不替换用户 .env
// ============================================================


import { stdin as input, stdout as output } from "process";

import * as path from "path";
import { randomUUID } from "node:crypto";
import * as auth from "../auth/service.js";
import type { AuthProfile, AuthCredential } from "../auth/types.js";
import type { QlingConfig } from "../config.js";
import { markOnboardingComplete } from "../onboarding/tutorial.js";
import { isHttpEndpoint, validateModelName } from "../providers/resolve-llm.js";
import * as os from "os";
import { getLocalizedText } from "../i18n/index.js";
import { getProviderPreset, listProviderPresets } from "../providers/presets.js";

export interface SetupEnvInput {
  provider: string;
  endpoint: string;
  model: string;
}

export function buildSetupEnvLines(input: SetupEnvInput): string[] {
  return [
    `QLING_LLM_PROVIDER=${input.provider}`,
    `QLING_LLM_ENDPOINT=${input.endpoint}`,
    `QLING_LLM_MODEL=${input.model}`,
  ];
}

export function formatSetupApiKeyInstructions(keyProvided: boolean): string[] {
  const t = getLocalizedText();
  const lines = [
    "",
    keyProvided ? t.setup.keyNotSaved : t.setup.keyNotConfigured,
    t.setup.windowsPowershellPersistent,
    `  ${t.setup.windowsEnvExample}`,
    t.setup.windowsPowershellTemp,
    "  $env:QLING_LLM_API_KEY='<your-key>'",
    t.setup.keyEnvNote,
  ];
  return lines;
}

export interface SetupPrompt {
  ask(label: string, options?: { secret?: boolean }): Promise<string | null>;
  write(line: string): void;
  close(): void;
}
/** One owner of stdin at a time; secret bytes never reach the terminal writer. */
export function createTerminalPrompt(
  stream: NodeJS.ReadStream = input,
  writer: Pick<NodeJS.WriteStream, "write"> = output,
): SetupPrompt {
  let cancelPending: (() => void) | undefined;
  return {
    write: (line) => { writer.write(line + "\n"); },
    close: () => cancelPending?.(),
    ask: (label, options = {}) => new Promise((resolve) => {
      if (!stream.isTTY || typeof stream.setRawMode !== "function") { resolve(null); return; }
      const previousRaw = stream.isRaw, wasPaused = stream.isPaused();
      let value = "", finished = false;
      const finish = (answer: string | null) => {
        if (finished) return;
        finished = true;
        stream.off("data", onData); stream.off("end", onEnd); stream.off("error", onEnd);
        stream.setRawMode(previousRaw);
        if (wasPaused) stream.pause();
        cancelPending = undefined;
        writer.write("\n"); resolve(answer);
      };
      const onEnd = () => finish(null);
      const onData = (bytes: Buffer | string) => {
        // Bracketed paste wrappers and cursor movement are not part of a credential.
        const chunk = bytes.toString().replace(/\x1b\[(?:200|201)~/g, "").replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
        for (const char of chunk) {
          if (char === "\x03" || char === "\x04" || char === "\x1b") { finish(null); return; }
          if (char === "\r" || char === "\n") { finish(value); return; }
          if (char === "\x7f" || char === "\b") {
            if (value) { value = Array.from(value).slice(0, -1).join(""); if (!options.secret) writer.write("\b \b"); }
          } else if (char >= " " && char !== "\x7f") {
            value += char; if (!options.secret) writer.write(char);
          }
        }
      };
      cancelPending = () => finish(null);
      writer.write(label);
      stream.setRawMode(true); stream.on("data", onData); stream.once("end", onEnd); stream.once("error", onEnd); stream.resume();
    }),
  };
}
export async function shouldRunFirstRunSetup(
  config: Pick<QlingConfig, "llm" | "runtime">,
  options: { isTTY?: boolean; json?: boolean } = {},
): Promise<boolean> {
  if (!(options.isTTY ?? Boolean(input.isTTY && output.isTTY)) || options.json) return false;
  if (["chatgpt", "grok-account"].includes(config.llm.provider)) {
    const status = await auth.inspectActiveConnection(config.runtime.file_state_dir);
    return status.profile?.provider !== config.llm.provider || status.status !== "ready";
  }
  const preset = getProviderPreset(config.llm.provider);
  if (preset?.requiresApiKey === false || ["ollama", "local"].includes(config.llm.provider)) return false;
  return !config.llm.api_key?.trim();
}
interface WizardServices {
  loginChatGpt?: typeof auth.loginChatGpt;
  loginGrok?: typeof auth.loginGrok;
  saveConnection?: typeof auth.saveConnection;
  markComplete?: typeof markOnboardingComplete;
  listModels?: typeof listPendingAccountModels;
  openBrowser?: (url: string) => Promise<void>;
}
export type SetupResult = { status: "saved"; profile: AuthProfile } | { status: "cancelled" | "skipped" };
class CancelSetup extends Error { }
class BackSetup extends Error { }
export async function runConnectionWizard(options: {
  stateDir: string; prompt?: SetupPrompt; isTTY?: boolean;
  account?: "chatgpt" | "grok"; services?: WizardServices;
}): Promise<SetupResult> {
  if (!(options.isTTY ?? Boolean(input.isTTY && output.isTTY))) return { status: "skipped" };
  const prompt = options.prompt ?? createTerminalPrompt();
  const services = options.services ?? {};
  const controller = new AbortController();
  const onInterrupt = () => { controller.abort(); prompt.close(); };
  process.once("SIGINT", onInterrupt);
  const ask = async (label: string, secret = false) => {
    const answer = await prompt.ask(label, { secret });
    if (answer === null || answer.trim() === "/cancel") throw new CancelSetup();
    if (answer.trim() === "/back") throw new BackSetup();
    return answer.trim();
  };
  try {
    prompt.write("\n欢迎使用 Qling：1. ChatGPT 账号  2. Grok 账号  3. API Key  4. 本地模型  5. 稍后配置\nCtrl+C / Esc / /cancel 取消；/back 返回连接选择。");
    while (true) {
      try {
        const choice = options.account === "chatgpt" ? "1" : options.account === "grok" ? "2" : await ask("连接方式 [1]: ") || "1";
        if (choice === "5") throw new CancelSetup();
        let profile: AuthProfile;
        let credential: AuthCredential | undefined;
        if (choice === "1" || choice === "2") {
          prompt.write(choice === "1" ? "将打开官方 ChatGPT 授权页面；登录不代表模型或订阅权限已验证。" : "将调用官方 Grok Build CLI 登录并复用其会话；Qling 不会安装 CLI。官方入口：https://x.ai/cli");
          const session = choice === "1"
            ? await (services.loginChatGpt ?? auth.loginChatGpt)({ stateDir: options.stateDir, signal: controller.signal, onUrl: url => prompt.write(`请在浏览器授权：${url}`), openBrowser: services.openBrowser ?? openAuthorizationBrowser })
            : await (services.loginGrok ?? auth.loginGrok)({ stateDir: options.stateDir, signal: controller.signal });
          profile = { ...session.profile }; credential = "credential" in session ? session.credential : undefined;
        } else if (choice === "3" || choice === "4") {
          let provider = "ollama", endpoint = "http://localhost:11434/v1", model = "llama3", requiresKey = false;
          if (choice === "3") {
            const presets = listProviderPresets();
            prompt.write(presets.map((p, i) => `${i + 1}. ${p.displayName}`).join("\n") + `\n${presets.length + 1}. 自定义兼容 API`);
            const selected = await ask("提供商 [1]: ") || "1";
            const preset = presets[Number(selected) - 1] ?? presets.find(p => p.id === selected);
            if (preset) { provider = preset.provider; endpoint = preset.endpoint; model = preset.model; requiresKey = preset.requiresApiKey; }
            else if (selected === String(presets.length + 1)) { provider = await ask("Provider 名称 [custom]: ") || "custom"; endpoint = ""; model = ""; requiresKey = true; }
            else { prompt.write("请选择列表中的提供商。"); continue; }
          } else {
            provider = await ask("本地 Provider [ollama]: ") || provider;
            if (!["ollama", "local"].includes(provider)) { prompt.write("本地模式请选择 ollama 或 local。"); continue; }
          }
          endpoint = await ask(`Endpoint [${endpoint}]: `) || endpoint;
          if (!isHttpEndpoint(endpoint)) { prompt.write("Endpoint 必须是无凭据的 http(s) URL。"); continue; }
          const url = new URL(endpoint);
          if (url.username || url.password || url.search || url.hash) { prompt.write("Endpoint 不能包含凭据、查询参数或片段。"); continue; }
          if (choice === "4" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) { prompt.write("本地免 Key 模式仅接受 loopback 地址。"); continue; }
          if (requiresKey) { const apiKey = await ask("API Key（隐藏输入）: ", true); if (!apiKey) { prompt.write("API Key 不能为空。"); continue; } credential = { apiKey }; }
          profile = { id: randomUUID(), provider, endpoint, model, method: requiresKey ? "api_key" : "none" };
        } else { prompt.write("请选择 1–5。"); continue; }
        let models: string[] = [];
        if (["chatgpt_oauth", "grok_cli_session"].includes(profile.method)) {
          prompt.write("读取所选账号的模型目录（不发送推理请求）…");
          const catalog = await (services.listModels ?? listPendingAccountModels)(profile, credential, { signal: controller.signal });
          if (catalog.ok) models = catalog.models;
          else prompt.write("账号模型目录不可用；可手动填写，尚未验证。");
        }
        if (models.length) prompt.write(models.map((m, i) => `${i + 1}. ${m}`).join("\n"));
        prompt.write("可选目录编号或手动模型 ID；模型推理尚未验证，保存不会发送付费测试请求。");
        const answer = await ask(`模型 ID [${models[0] || profile.model}]: `);
        profile.model = models[Number(answer) - 1] || answer || models[0] || profile.model;
        const invalid = validateModelName(profile.model);
        if (!profile.model || invalid) { prompt.write(invalid || "模型 ID 不能为空。"); continue; }
        prompt.write(`Provider: ${profile.provider}\n数据发送至: ${profile.endpoint}\nModel: ${profile.model}（尚未验证）\n认证方式: ${profile.method}\n凭据: ${process.platform === "win32" ? "当前 Windows 用户 DPAPI 加密" : "私有目录、0600 文件权限保护；并非系统钥匙串加密"}\n连接保存至: ${path.join(options.stateDir, "auth")}；保留现有 .env 和高级设置。`);
        if ((await ask("保存并使用此连接？[Y/n]: ")).toLowerCase() === "n") throw new CancelSetup();
        try { await (services.saveConnection ?? auth.saveConnection)(options.stateDir, profile, credential); }
        catch { throw Error("连接保存失败；请检查本地认证状态和目录权限后重试 qling setup。"); }
        try { await (services.markComplete ?? markOnboardingComplete)(options.stateDir); }
        catch { prompt.write("连接已保存，但首次使用标记写入失败；连接仍可使用。"); }
        prompt.write("连接已保存；模型推理尚未验证。现在可在当前会话输入任务。");
        return { status: "saved", profile };
      } catch (error) {
        if (error instanceof BackSetup && !options.account) continue;
        throw error;
      }
    }
  } catch (error) {
    if (error instanceof CancelSetup || error instanceof BackSetup || controller.signal.aborted) { prompt.write("已取消；未保存新连接。"); return { status: "cancelled" }; }
    throw error;
  } finally { process.off("SIGINT", onInterrupt); controller.abort(); prompt.close(); }
}
export async function runSetup(options: { stateDir?: string } = {}): Promise<void> {
  const result = await runConnectionWizard({ stateDir: options.stateDir ?? path.join(os.homedir(), ".qling") });
  if (result.status === "skipped") output.write("需要交互式终端；请在终端运行 qling setup。\n");
}

async function openAuthorizationBrowser(url: string): Promise<void> {
  const target = new URL(url);
  if (target.origin !== "https://auth.openai.com" || target.username || target.password) throw Error("Invalid authorization origin");
  await new Promise<void>((resolve) => {
    const child = process.platform === "win32" ? spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { stdio: "ignore", windowsHide: true })
      : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" });
    child.once("error", () => resolve()); child.once("spawn", () => { child.unref(); resolve(); });
  });
}
