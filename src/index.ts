#!/usr/bin/env node
// ============================================================
// 轻灵 - CLI 入口
// 契约:
//   默认启动: qingling               -> chat (TUI)
//   单次任务: qingling run "任务"    -> run
//   REPL:     qingling repl          -> repl
// ============================================================

import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import os from "os";
import dotenv from "dotenv";

import { AgentLoop } from "./agent-loop.js";
import { Repl } from "./repl.js";
import { StreamingREPL } from "./tui/streaming-repl.js";
import { buildHelpText, formatCliError, parseCliArgs } from "./cli/startup-contract.js";
import { applyConfigToProcessEnv, loadQinglingConfig } from "./config.js";
import {
  CliChannelBootstrapError,
  resolveRunModeChannel,
} from "./cli/channel-bootstrap.js";
import { buildToolRegistry } from "./tools/index.js";
import { runSetup } from "./cli/setup.js";
import { checkOnboarding } from "./onboarding/tutorial.js";
import type { AgentConfig } from "./types.js";

function findEnvPaths(): string[] {
  const paths: string[] = [];
  
  // 1. 项目配置 (从当前目录向上查找，最优先)
  let dir = process.cwd();
  while (true) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) {
      paths.push(envPath);
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // 2. 全局配置 (~/.qingling/.env，作为回退)
  const globalEnv = path.join(os.homedir(), ".qingling", ".env");
  if (fs.existsSync(globalEnv)) {
    paths.push(globalEnv);
  }

  // 3. 回退: 如果啥也没找到，默认指向当前目录 .env
  if (paths.length === 0) {
    paths.push(path.join(process.cwd(), ".env"));
  }

  return paths;
}

const envPaths = findEnvPaths();
for (const p of envPaths) {
  dotenv.config({ path: p });
}

async function main() {
  const decision = parseCliArgs(process.argv.slice(2));
  if (decision.kind === "error") {
    console.error(formatCliError(decision.code, decision.message));
    process.exit(decision.exitCode);
  }

  if (decision.mode === "help") {
    console.log(buildHelpText("qingling"));
    process.exit(0);
  }

  // v0.4 Onboarding Tutorial (仅在交互模式下触发)
  if (decision.mode === "chat" || decision.mode === "repl") {
    await checkOnboarding();
  }

  for (const warning of decision.warnings) {
    console.error(`Warning: ${warning}`);
  }

  let loaded;
  try {
    loaded = await loadQinglingConfig(decision.global);
  } catch (err) {
    console.error(
      formatCliError("CONFIG_LOAD_FAILED", err instanceof Error ? err.message : String(err))
    );
    process.exit(1);
  }

  for (const warning of loaded.warnings) {
    console.error(`Warning: ${warning}`);
  }
  applyConfigToProcessEnv(loaded.config);

  const staticEnabled: Record<string, boolean> = {};
  for (const [name, cfg] of Object.entries(loaded.config.tools)) {
    staticEnabled[name] = cfg.enabled;
  }
  const tools = buildToolRegistry({ staticEnabled });

  const agentConfig: Partial<AgentConfig> = {
    apiKey:
      loaded.config.llm.api_key ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "",
    provider: loaded.config.llm.provider,
    endpoint: loaded.config.llm.endpoint,
    model: loaded.config.llm.model,
    maxIterations: loaded.config.runtime.max_steps,
    tools,
    tokenBudget: {
      maxTokens: loaded.config.runtime.max_token_budget,
      totalBudget: loaded.config.runtime.max_token_budget,
      nudgeThreshold: 0.2,
    },
    runtime: {
      workspaceDir: loaded.config.runtime.workspace_dir,
      fileCacheDir: loaded.config.runtime.file_cache_dir,
      fileStateDir: loaded.config.runtime.file_state_dir,
      maxSteps: loaded.config.runtime.max_steps,
      parseRetries: loaded.config.runtime.parse_retries,
      maxTokenBudget: loaded.config.runtime.max_token_budget,
      toolRepeatLimit: loaded.config.runtime.tool_repeat_limit,
      timeoutMs: loaded.config.runtime.timeout_ms,
    },
    logging: {
      level: loaded.config.logging.level,
      format: loaded.config.logging.format,
      inspectPrompt: loaded.config.logging.inspect_prompt,
      inspectRequest: loaded.config.logging.inspect_request,
      inspectDumpDir: loaded.config.logging.inspect_dump_dir,
    },
  };

  // v0.3 Management Subcommands
  if (decision.mode === "setup") {
    await runSetup();
    return;
  }

  // --- 延迟实例化 AgentLoop，防止 setup 等管理命令因缺失 Key 而崩溃 ---
  const agent = new AgentLoop(agentConfig);
  await agent.waitForInit();

  if (decision.mode === "workflow") {
    const [sub, runId] = decision.subArgs;
    if (sub === "resume" && runId) {
      console.error(`🔄 正在从 Checkpoint 恢复: ${runId}`);
      try {
        const checkpoint = await agent.getWorkflowRuntime().resume(runId);
        agent.syncWorkflowState(checkpoint);
        const response = await agent.run();
        console.log(response);
        return;
      } catch (err) {
        console.error(formatCliError("WORKFLOW_RESUME_FAILED", (err as Error).message));
        process.exit(1);
      }
    }
    console.error("用法: qingling workflow resume <run_id>");
    process.exit(1);
  }

  if (decision.mode === "memory") {
    const [sub] = decision.subArgs;
    if (sub === "reindex") {
      console.error("🧠 正在重新构建语义记忆向量索引...");
      try {
        await agent.getMemoryStore().rebuildSemanticIndex();
        console.error("✅ 索引重建完成");
        return;
      } catch (err) {
        console.error(formatCliError("MEMORY_REINDEX_FAILED", (err as Error).message));
        process.exit(1);
      }
    }
    console.error("用法: qingling memory reindex [--full]");
    process.exit(1);
  }

  if (decision.mode === "dashboard") {
    const [sub] = decision.subArgs;
    if (sub === "start") {
      // Dashboard already starts if enabled in init, but we can force it or keep process alive
      console.error("📊 Dashboard 运行中。按 Ctrl+C 退出。");
      await new Promise(() => {}); // Keep alive
      return;
    }
    console.error("用法: qingling dashboard start");
    process.exit(1);
  }

  if (decision.mode === "discovery") {
    const [sub] = decision.subArgs;
    if (sub === "sync") {
      console.error("🔍 正在同步动态插件与技能...");
      await agent.getDiscoveryRegistry().syncAll();
      const items = agent.getDiscoveryRegistry().getAllItems();
      console.error(`✅ 同步完成，共发现 ${items.length} 个项目:`);
      items.forEach(it => console.error(`  - [${it.manifest.type}] ${it.manifest.name} v${it.manifest.version}`));
      return;
    }
    console.error("用法: qingling discovery sync");
    process.exit(1);
  }

  if (decision.mode === "run") {
    try {
      const channel = resolveRunModeChannel(decision.mode, loaded.config.channels);
      if (channel) {
        await channel.start();
        agent.setChannel(channel);
      }
    } catch (err) {
      if (err instanceof CliChannelBootstrapError) {
        console.error(formatCliError(err.code, err.message));
        process.exit(1);
      }
      console.error(
        formatCliError(
          "CLI_CHANNEL_INIT_FAILED",
          err instanceof Error ? err.message : String(err)
        )
      );
      process.exit(1);
    }
  }

  if (decision.mode === "chat") {
    const repl = new StreamingREPL(agent);
    await repl.start();
    return;
  }

  if (decision.mode === "repl") {
    const repl = new Repl(agent);
    await repl.start();
    return;
  }

  try {
    const task = decision.task ?? "";
    agent.addUserMessage(task);
    const response = await agent.run();
    console.log(response);
  } catch (err) {
    console.error(formatCliError("RUN_FAILED", err instanceof Error ? err.message : String(err)));
    process.exit(1);
  } finally {
    try {
      await agent.shutdown();
    } catch {
      // ignore shutdown cleanup failures in CLI exit path
    }
  }
}

main();
