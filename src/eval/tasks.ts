// ============================================================
// 轻灵 - 本地 smoke 评测任务集
// ============================================================

import { writeFile, readFile, mkdir } from "fs/promises";
import { join } from "path";
import type { EvalTask } from "./types.js";
import {
  checkSensitiveWriteTarget,
  isPathAllowedForWrite,
  resolveWriteSandboxMode,
} from "../runtime-paths.js";
import { resolveNetworkGuardMode, checkUrlFetchPolicy } from "../guard.js";
import { getProviderPreset, listProviderPresets } from "../providers/presets.js";
import { buildOnboardingSteps } from "../onboarding/tutorial.js";
import { listMcpPresets, getMcpPreset } from "../mcp/presets.js";
import { PLAN_MODE_DENY_TOOLS, HookManager } from "../pipeline/hooks.js";
import { formatToolOutputCard } from "../tui/shell.js";
import type { GuardConfig } from "../config.js";

function miniGuard(overrides: Partial<GuardConfig["network"]["url_fetch"]> = {}): GuardConfig {
  return {
    enabled: true,
    network: {
      url_fetch: {
        allowed_url_prefixes: ["https://"],
        deny_private_ips: true,
        follow_redirects: false,
        ...overrides,
      },
    },
    redaction: { enabled: false, patterns: [] },
    audit: { jsonl_path: "" },
    rate_limit: { enabled: false, max_per_minute: 0 },
    content_filter: {
      enabled: false,
      pii_detection: false,
      injection_detection: false,
      custom_patterns: [],
    },
    permissions: { default: "allow", rules: [] },
  };
}

export function buildEvalSmokeTasks(): EvalTask[] {
  return [
    {
      id: "write-sandbox-default",
      title: "写沙箱默认 workspace",
      run: async () => {
        const mode = resolveWriteSandboxMode({});
        const ok = mode === "workspace";
        return { ok, detail: `mode=${mode}` };
      },
    },
    {
      id: "write-sandbox-blocks-outside",
      title: "写沙箱拒绝工作区外路径",
      run: async ({ workspaceDir }) => {
        const roots = {
          workspaceDir,
          fileCacheDir: join(workspaceDir, ".cache"),
          fileStateDir: join(workspaceDir, ".state"),
        };
        const inside = isPathAllowedForWrite(join(workspaceDir, "a.ts"), roots, "workspace");
        const outside = isPathAllowedForWrite(join(workspaceDir, "..", "out.ts"), roots, "workspace");
        const ok = inside && !outside;
        return { ok, detail: `inside=${inside} outside=${outside}` };
      },
    },
    {
      id: "sensitive-write-env",
      title: "敏感写拦截 .env",
      run: async ({ workspaceDir }) => {
        const hit = checkSensitiveWriteTarget(join(workspaceDir, ".env"), {});
        const ok = Boolean(hit?.blocked);
        return { ok, detail: hit?.code ?? "no-block" };
      },
    },
    {
      id: "network-mode-deny",
      title: "网络 mode=deny 阻断 https",
      run: async () => {
        const decision = await checkUrlFetchPolicy(
          new URL("https://example.com"),
          miniGuard(),
          { QLING_GUARD_NETWORK_MODE: "deny" }
        );
        return {
          ok: decision.allowed === false,
          detail: decision.reason ?? "no-reason",
        };
      },
    },
    {
      id: "network-mode-open-http",
      title: "网络 mode=open 允许 http",
      run: async () => {
        const mode = resolveNetworkGuardMode({ QLING_GUARD_NETWORK_MODE: "open" });
        const decision = await checkUrlFetchPolicy(
          new URL("http://example.com"),
          miniGuard(),
          { QLING_GUARD_NETWORK_MODE: "open" }
        );
        return {
          ok: mode === "open" && decision.allowed === true,
          detail: `mode=${mode} allowed=${decision.allowed}`,
        };
      },
    },
    {
      id: "provider-presets",
      title: "Provider 预设含 ollama/deepseek",
      run: async () => {
        const list = listProviderPresets();
        const ollama = getProviderPreset("ollama");
        const ok = list.length >= 8 && ollama?.provider === "ollama";
        return { ok, detail: `count=${list.length} ollama=${ollama?.id}` };
      },
    },
    {
      id: "mcp-presets",
      title: "MCP 预设表非空且可解析",
      run: async () => {
        const list = listMcpPresets();
        const fs = getMcpPreset("filesystem");
        const ok = list.length >= 3 && Boolean(fs?.server?.command);
        return { ok, detail: `count=${list.length} filesystem=${fs?.id}` };
      },
    },
    {
      id: "plan-mode-denies-write",
      title: "Plan Mode 拒绝 write",
      run: async () => {
        const hm = new HookManager(
          [
            { name: "write", description: "w", parameters: { type: "object", properties: {} } },
            { name: "read", description: "r", parameters: { type: "object", properties: {} } },
          ],
          miniGuard()
        );
        hm.setPlanMode(true);
        const baseCtx = {
          arguments: {} as Record<string, unknown>,
          inputSchema: {},
          isConcurrencySafe: true,
          dangerousPatterns: [] as string[],
        };
        const write = await hm.runPreHook({
          ...baseCtx,
          toolName: "write",
          isReadOnly: false,
          isDestructive: false,
        });
        const read = await hm.runPreHook({
          ...baseCtx,
          toolName: "read",
          isReadOnly: true,
          isDestructive: false,
        });
        const ok =
          write.decision === "deny" &&
          read.decision === "allow" &&
          PLAN_MODE_DENY_TOOLS.includes("write");
        return { ok, detail: `write=${write.decision} read=${read.decision}` };
      },
    },
    {
      id: "onboarding-steps",
      title: "Onboarding 至少 3 步",
      run: async () => {
        const steps = buildOnboardingSteps();
        return { ok: steps.length >= 3, detail: `steps=${steps.length}` };
      },
    },
    {
      id: "tool-output-card-collapse",
      title: "工具输出折叠卡片",
      run: async () => {
        const long = Array.from({ length: 20 }, (_, i) => `L${i}`).join("\n");
        const card = formatToolOutputCard(long, { expand: false });
        return {
          ok: card.collapsed && card.hidden > 0,
          detail: `hidden=${card.hidden} lines=${card.totalLines}`,
        };
      },
    },
    {
      id: "workspace-roundtrip",
      title: "工作区读写往返",
      run: async ({ workspaceDir }) => {
        await mkdir(workspaceDir, { recursive: true });
        const file = join(workspaceDir, "eval-roundtrip.txt");
        await writeFile(file, "qling-eval\n", "utf8");
        const text = await readFile(file, "utf8");
        return { ok: text.includes("qling-eval"), detail: `bytes=${text.length}` };
      },
    },
  ];
}
