// ============================================================
// 轻灵 - 初始配置向导 (v0.3)
// 提供交互式命令行，快速配置国内主流 LLM Provider
// ============================================================

import * as readline from "readline/promises";
import { stdin as input, stdout as output } from "process";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

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

export async function runSetup() {
  const rl = readline.createInterface({ input, output });

  console.log("\n=========================================");
  console.log("轻灵 Qling - 快速配置");
  console.log("=========================================\n");
  console.log("默认路径只配置 Provider / Model / API key；高级能力稍后可在 Advanced 中开启。");

  console.log("\n请选择 LLM 提供商 (输入数字序号):");
  console.log("1. DeepSeek (推荐)");
  console.log("2. 阿里云百炼 (Qwen)");
  console.log("3. 智谱清言 (GLM)");
  console.log("4. 月之暗面 (Kimi)");
  console.log("5. MiniMax (海螺)");
  console.log("6. Xiaomi MiMo (按量计费)");
  console.log("7. Xiaomi MiMo (Token Plan 订阅用户)");
  console.log("8. 硅基流动 (SiliconFlow)");
  console.log("9. OpenAI");
  console.log("10. 本地部署 (Ollama)");
  console.log("11. 自定义 (Custom)");

  const choice = (await rl.question("\n您的选择 [默认: 1]: ")).trim() || "1";

  let pName = "";
  let pEndpoint = "";
  let pModel = "";

  if (choice === "11" || !PRESETS[choice]) {
    pName = (await rl.question("输入 Provider 名称: ")).trim() || "custom";
    pEndpoint = (await rl.question("输入 API Base URL (例如 https://api.xxx.com/v1): ")).trim();
    pModel = (await rl.question("输入默认 Model 名称: ")).trim();
  } else {
    const preset = PRESETS[choice];
    pName = preset.name;
    pEndpoint = (await rl.question(`配置 Endpoint URL [默认: ${preset.endpoint}]: `)).trim() || preset.endpoint;
    pModel = (await rl.question(`配置 Model 名称 [默认: ${preset.model}]: `)).trim() || preset.model;
  }

  const preset = PRESETS[choice];
  const keyHint = preset?.keyHint ? ` (${preset.keyHint})` : "";
  const apiKey = await rl.question(`请输入 API Key${keyHint}: `);
  const key = apiKey.trim();

  console.log("\n-----------------------------------------");
  console.log(`Provider : ${pName}`);
  console.log(`Endpoint : ${pEndpoint}`);
  console.log(`Model    : ${pModel}`);
  console.log(`API Key  : ${key ? "********" : "(未配置)"}`);
  console.log("-----------------------------------------");

  const confirm = await rl.question("保存为全局默认配置? (Y/n): ");
  if (confirm.trim().toLowerCase() === 'n') {
    console.log("已取消配置。");
    rl.close();
    return;
  }

  // 构造环境变量内容
  const envLines = [
    `QLING_LLM_PROVIDER=${pName}`,
    `QLING_LLM_ENDPOINT=${pEndpoint}`,
    `QLING_LLM_MODEL=${pModel}`,
  ];
  if (key) {
    envLines.push(`QLING_LLM_API_KEY=${key}`);
    envLines.push(`OPENAI_API_KEY=${key}`);
    envLines.push(`DEEPSEEK_API_KEY=${key}`);
  }

  const advanced = await rl.question("\n是否进入 Advanced 高级配置? (y/N): ");
  if (advanced.trim().toLowerCase() === "y") {
    const useForVision = await rl.question("是否将此 Provider 同时设为默认视觉分析 Provider? (y/N): ");
    if (useForVision.trim().toLowerCase() === "y") {
      envLines.push(`QLING_VISION_PROVIDER=${pName}`);
      envLines.push(`QLING_VISION_MODEL=${pModel}`);
      envLines.push(`QLING_VISION_ENDPOINT=${pEndpoint}`);
    }

    const enableDashboard = await rl.question("是否开启 Web 观测控制台 Dashboard? (y/N): ");
    if (enableDashboard.trim().toLowerCase() === "y") {
      envLines.push("QLING_FEATURES_DASHBOARD=true");
      envLines.push("QLING_METRICS_ENABLED=true");
      const port = await rl.question("  - 端口 [默认: 9999]: ");
      if (port.trim()) envLines.push(`QLING_DASHBOARD_PORT=${port.trim()}`);
    }

    const enableSemantic = await rl.question("是否开启语义记忆? (y/N): ");
    if (enableSemantic.trim().toLowerCase() === "y") {
      envLines.push("QLING_FEATURES_SEMANTIC_MEMORY=true");
    }

    const enableWorkflow = await rl.question("是否开启状态机编排与 Checkpoint? (y/N): ");
    if (enableWorkflow.trim().toLowerCase() === "y") {
      envLines.push("QLING_FEATURES_WORKFLOW_RUNTIME=true");
    }

    const enableSpecBoost = await rl.question("是否开启工具规范增强? (y/N): ");
    if (enableSpecBoost.trim().toLowerCase() === "y") {
      envLines.push("QLING_FEATURES_TOOL_SPEC_BOOST=true");
    }

    const enableDiscovery = await rl.question("是否开启动态技能发现? (y/N): ");
    if (enableDiscovery.trim().toLowerCase() === "y") {
      envLines.push("QLING_FEATURES_DYNAMIC_DISCOVERY=true");
    }
  }

  const globalEnvPath = path.join(os.homedir(), ".qling", ".env");
  await fs.mkdir(path.dirname(globalEnvPath), { recursive: true });
  await fs.writeFile(globalEnvPath, envLines.join("\n") + "\n", "utf-8");

  console.log(`\n配置已保存: ${globalEnvPath}`);
  console.log("-----------------------------------------");
  console.log("下一步:");
  console.log("- `qling` 进入 TUI");
  console.log("- `/help` 查看命令面板");
  console.log("- `/doctor` 检查本地环境");
  console.log("- `/privacy` 查看数据边界");
  console.log("- `qling run \"分析这个仓库\"` 验证单次执行");
  console.log("-----------------------------------------");
  rl.close();
}
