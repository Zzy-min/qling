// ============================================================
// 轻灵 - 初始配置向导 (v0.3)
// 提供交互式命令行，快速配置国内主流 LLM Provider
// ============================================================

import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { getLocalizedText } from "../i18n/index.js";

interface ProviderPreset {
  name: string;
  name_display?: string;
  endpoint: string;
  model: string;
  keyHint?: string;
}

const PRESETS: Record<string, ProviderPreset> = {
  "1": { name: "deepseek", endpoint: "https://api.deepseek.com", model: "deepseek-chat" },
  "2": { name: "dashscope", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", keyHint: "阿里云 API Key" },
  "3": { name: "zhipu", endpoint: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4", keyHint: "智谱 AI Key" },
  "4": { name: "moonshot", endpoint: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", keyHint: "Kimi API Key" },
  "5": { name: "minimax", endpoint: "https://api.minimaxi.com/v1", model: "MiniMax-M2.7", keyHint: "MiniMax API Key" },
  "6": { name: "mimo", name_display: "Xiaomi MiMo (按量计费)", endpoint: "https://api.xiaomimimo.com/v1", model: "MiMo-V2.5-Pro", keyHint: "小米 MiMo sk-xxx" },
  "7": { name: "mimo", name_display: "Xiaomi MiMo (Token Plan 订阅用户)", endpoint: "https://token-plan-cn.xiaomimimo.com/v1", model: "MiMo-V2.5-Pro", keyHint: "小米 MiMo tp-xxx" },
  "8": { name: "siliconflow", endpoint: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct", keyHint: "硅基流动 Key" },
  "9": { name: "openai", endpoint: "https://api.openai.com/v1", model: "gpt-4o" },
  "10": { name: "local", endpoint: "http://localhost:11434/v1", model: "llama3", keyHint: "Ollama (可留空)" },
};

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

export async function runSetup() {
  const rl = readline.createInterface({ input, output });
  const t = getLocalizedText();

  console.log("\n=========================================");
  console.log(t.setup.title);
  console.log("=========================================\n");
  console.log(t.setup.quickPath);

  console.log("\n" + t.setup.chooseProvider);
  const providerList = t.setup.providers;
  console.log("1. " + providerList["1"]);
  console.log("2. " + providerList["2"]);
  console.log("3. " + providerList["3"]);
  console.log("4. " + providerList["4"]);
  console.log("5. " + providerList["5"]);
  console.log("6. " + providerList["6"]);
  console.log("7. " + providerList["7"]);
  console.log("8. " + providerList["8"]);
  console.log("9. " + providerList["9"]);
  console.log("10. " + providerList["10"]);
  console.log("11. " + providerList["11"]);

  const choice = (await rl.question("\n您的选择 [默认: 1]: ")).trim() || "1";

  let pName = "";
  let pEndpoint = "";
  let pModel = "";

  if (choice === "11" || !PRESETS[choice]) {
    pName = (await rl.question(t.setup.customPrompts.providerName)).trim() || "custom";
    pEndpoint = (await rl.question(t.setup.customPrompts.endpoint)).trim();
    pModel = (await rl.question(t.setup.customPrompts.model)).trim();
  } else {
    const preset = PRESETS[choice];
    pName = preset.name;
    const epPrompt = (t.setup.configEndpointPrompt || "配置 Endpoint URL [默认: {endpoint}]: ").replace("{endpoint}", preset.endpoint);
    const modelPrompt = (t.setup.configModelPrompt || "配置 Model 名称 [默认: {model}]: ").replace("{model}", preset.model);
    pEndpoint = (await rl.question(epPrompt)).trim() || preset.endpoint;
    pModel = (await rl.question(modelPrompt)).trim() || preset.model;
  }

  const preset = PRESETS[choice];
  const keyHint = preset?.keyHint ? ` (${preset.keyHint})` : "";
  const apiKey = await rl.question(`${getLocalizedText().setup.keyPrompt}${keyHint}: `);
  const key = apiKey.trim();

  console.log("\n" + t.setup.summaryHeader);
  console.log(`Provider : ${pName}`);
  console.log(`Endpoint : ${pEndpoint}`);
  console.log(`Model    : ${pModel}`);
  console.log(`API Key  : ${key ? "未保存到 .env（请配置系统环境变量）" : "(未配置)"}`);
  console.log(t.setup.summaryFooter);

  const confirm = await rl.question(t.setup.confirmSave);
  if (confirm.trim().toLowerCase() === 'n') {
    console.log(t.setup.canceled);
    rl.close();
    return;
  }

  // 构造环境变量内容
  const envLines = buildSetupEnvLines({
    provider: pName,
    endpoint: pEndpoint,
    model: pModel,
  });

  const advanced = await rl.question("\n" + t.setup.advancedPrompt);
  if (advanced.trim().toLowerCase() === "y") {
    const useForVision = await rl.question(t.setup.advanced.vision);
    if (useForVision.trim().toLowerCase() === "y") {
      envLines.push(`QLING_VISION_PROVIDER=${pName}`);
      envLines.push(`QLING_VISION_MODEL=${pModel}`);
      envLines.push(`QLING_VISION_ENDPOINT=${pEndpoint}`);
    }

    const enableDashboard = await rl.question(t.setup.advanced.dashboard);
    if (enableDashboard.trim().toLowerCase() === "y") {
      envLines.push("QLING_FEATURES_DASHBOARD=true");
      envLines.push("QLING_METRICS_ENABLED=true");
      const port = await rl.question(t.setup.advanced.dashboardPort);
      if (port.trim()) envLines.push(`QLING_DASHBOARD_PORT=${port.trim()}`);
    }

    const enableSemantic = await rl.question(t.setup.advanced.semantic);
    if (enableSemantic.trim().toLowerCase() === "y") {
      envLines.push("QLING_FEATURES_SEMANTIC_MEMORY=true");
    }

    const enableWorkflow = await rl.question(t.setup.advanced.workflow);
    if (enableWorkflow.trim().toLowerCase() === "y") {
      envLines.push("QLING_FEATURES_WORKFLOW_RUNTIME=true");
    }

    const enableSpecBoost = await rl.question(t.setup.advanced.specBoost);
    if (enableSpecBoost.trim().toLowerCase() === "y") {
      envLines.push("QLING_FEATURES_TOOL_SPEC_BOOST=true");
    }

    const enableDiscovery = await rl.question(t.setup.advanced.discovery);
    if (enableDiscovery.trim().toLowerCase() === "y") {
      envLines.push("QLING_FEATURES_DYNAMIC_DISCOVERY=true");
    }
  }

  const globalEnvPath = path.join(os.homedir(), ".qling", ".env");
  await fs.mkdir(path.dirname(globalEnvPath), { recursive: true });
  await fs.writeFile(globalEnvPath, envLines.join("\n") + "\n", "utf-8");

  console.log(`\n${t.setup.savedTo}${globalEnvPath}`);
  for (const line of formatSetupApiKeyInstructions(Boolean(key))) {
    console.log(line);
  }
  console.log(t.setup.summaryFooter);
  console.log(t.setup.nextStepsHeader);
  for (const s of t.setup.nextSteps) {
    console.log(s);
  }
  console.log(t.setup.summaryFooter);
  rl.close();
}
