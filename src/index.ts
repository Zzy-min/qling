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
import type { AgentConfig } from "./types.js";

function findEnvPath(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const envPath = path.join(dir, ".env");
    if (fs.existsSync(envPath)) return envPath;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), ".env");
}

dotenv.config({ path: findEnvPath() });

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

  const agent = new AgentLoop(agentConfig);
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
    repl.start();
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
