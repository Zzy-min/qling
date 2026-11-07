import type { OptionPickerItem, OptionPickerSpec } from "./overlay-panel.js";
import {
  listAllGroupedProviderModelEntries,
  lookupModelWindow,
  lookupRetiredModel,
  presetsForProvider,
  getProviderPreset,
  type GroupedProviderSection,
  type ProviderModelEntry,
} from "../providers/presets.js";
import {
  isProviderCredentialReady,
  resolveProviderApiKey,
  type CredentialStatus,
} from "../providers/resolve-llm.js";

export interface ModelPickerCallbacks {
  applyModel: (modelName: string) => Promise<void> | void;
  applyPreset: (presetId: string) => Promise<void> | void;
  applyLlmSession?: (session: {
    provider: string;
    endpoint: string;
    model: string;
    apiKey: string;
  }) => Promise<void> | void;
  writeNotice: (msg: string) => void;
  writeError: (msg: string) => void;
  getStartupProvider?: () => string;
}

export interface BuildGroupedModelPickerOptions {
  currentProvider?: string;
  currentModel?: string;
  callbacks: ModelPickerCallbacks;
  env?: NodeJS.ProcessEnv;
  filterCurrentProviderOnly?: boolean;
}

export const PROVIDER_ALIASES: Record<string, string[]> = {
  deepseek: ["ds", "deepseek"],
  dashscope: ["qwen", "dashscope", "aliyun", "qianwen"],
  zhipu: ["glm", "zhipu", "bigmodel"],
  moonshot: ["kimi", "moonshot"],
  minimax: ["minimax", "hailuo"],
  mimo: ["mimo", "xiaomi"],
  siliconflow: ["siliconflow", "silicon"],
  anthropic: ["claude", "anthropic"],
  openai: ["gpt", "openai"],
  gemini: ["gemini", "google"],
  mistral: ["mistral", "codestral"],
  ollama: ["local", "ollama"],
  xai: ["grok", "xai"],
  openrouter: ["openrouter"],
  chatgpt: ["chatgpt", "openai"],
  "grok-account": ["grok", "xai"],
};

function formatTokens(n: number | undefined): string {
  if (!n) return "";
  if (n >= 1000000) return `${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function getModelDescription(model: string, provider: string): string {
  const meta = lookupModelWindow(model);
  const parts: string[] = [];
  if (meta?.contextWindow) {
    parts.push(`${formatTokens(meta.contextWindow)} ctx`);
  }
  if (meta?.maxOutputTokens) {
    parts.push(`${formatTokens(meta.maxOutputTokens)} out`);
  }
  const retired = lookupRetiredModel(model);
  if (retired) {
    parts.push(`已下线(建议: ${retired})`);
  }
  if (parts.length === 0) {
    parts.push(provider);
  }
  return parts.join(" · ");
}

/**
 * 构建多层级、分类凭据感知的模型选择器 Spec
 */
export function buildGroupedModelPickerSpec(options: BuildGroupedModelPickerOptions): OptionPickerSpec {
  const env = options.env ?? process.env;
  const currentProvider = (options.currentProvider ?? "").trim();
  const currentModel = (options.currentModel ?? "").trim();
  const callbacks = options.callbacks;

  let sections = listAllGroupedProviderModelEntries(currentProvider, currentModel);

  if (options.filterCurrentProviderOnly && currentProvider) {
    sections = sections.filter((s) => s.providerId.toLowerCase() === currentProvider.toLowerCase());
  }

  const items: OptionPickerItem[] = [];
  const allEntries: ProviderModelEntry[] = [];

  for (const sec of sections) {
    const cred: CredentialStatus = isProviderCredentialReady(sec.providerId, env);
    const isCurrentSec = sec.isCurrent;

    // 添加服务商 Section 标题头
    const sectionBadge = isCurrentSec ? "★ 当前" : cred.badge;
    items.push({
      id: `section:${sec.providerId}`,
      label: `─── ${sec.displayName} ───`,
      section: true,
      collapsible: true,
      sectionCount: sec.entries.length,
      tag: sectionBadge,
      disabled: false,
    });

    for (const entry of sec.entries) {
      allEntries.push(entry);
      const isModelActive = Boolean(
        isCurrentSec && (
          entry.model.toLowerCase() === currentModel.toLowerCase() ||
          (entry.presetId && currentModel.toLowerCase() === entry.model.toLowerCase())
        )
      );

      const desc = getModelDescription(entry.model, sec.displayName);
      const meta = lookupModelWindow(entry.model);
      const ctxTag = meta?.contextWindow ? `${formatTokens(meta.contextWindow)}` : undefined;

      const aliasSet = new Set<string>([
        sec.providerId,
        sec.displayName,
        entry.model,
        entry.label,
        ...(entry.presetId ? [entry.presetId] : []),
        ...(ctxTag ? [ctxTag] : []),
        ...(PROVIDER_ALIASES[sec.providerId] ?? []),
      ]);

      items.push({
        id: entry.id,
        label: entry.source === "preset" ? entry.label : entry.model,
        description: desc,
        active: isModelActive,
        tag: ctxTag || sec.displayName,
        aliases: Array.from(aliasSet),
      });
    }
  }

  const title = options.filterCurrentProviderOnly && currentProvider
    ? `模型切换 · ${currentProvider}`
    : "模型切换 · 按服务商浏览";

  return {
    title,
    filterable: true,
    footerHint: "↑/↓ 选择模型 · 输入文字过滤 · Enter 应用 · Esc 取消",
    selectedId: items.find((item) => item.active && !item.section)?.id,
    items,
    onPick: async (item: OptionPickerItem) => {
      if (item.section) return;

      const entry = allEntries.find((candidate) => candidate.id === item.id);
      if (entry?.presetId) {
        await callbacks.applyPreset(entry.presetId);
        return;
      }

      if (entry?.provider && entry.provider !== currentProvider) {
        const basePreset = presetsForProvider(entry.provider)[0];
        if (!basePreset) {
          callbacks.writeError(`❌ 未找到服务商 '${entry.provider}' 的基础配置。`);
          return;
        }
        const startup = callbacks.getStartupProvider ? callbacks.getStartupProvider() : currentProvider;
        const resolved = resolveProviderApiKey(basePreset.provider, env, {
          startupProvider: startup,
          sameProvider: false,
        });
        if (basePreset.requiresApiKey && resolved.refused) {
          callbacks.writeError(`❌ ${resolved.message}`);
          return;
        }
        if (!callbacks.applyLlmSession) {
          callbacks.writeError("❌ 当前 AgentLoop 不支持跨服务商模型切换。");
          return;
        }
        await callbacks.applyLlmSession({
          provider: basePreset.provider,
          endpoint: basePreset.endpoint,
          model: entry.model || basePreset.model,
          apiKey: resolved.apiKey,
        });
        callbacks.writeNotice(
          `已切换至 ${basePreset.displayName} (${basePreset.provider}) · ${entry.model || basePreset.model}`
        );
        return;
      }

      const targetModel = entry ? entry.model : item.label;
      await callbacks.applyModel(targetModel);
    },
  };
}

/**
 * 非 TUI 终端回退纯文本输出
 */
export function formatGroupedModelPickerLines(
  currentProvider?: string,
  currentModel?: string,
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const sections = listAllGroupedProviderModelEntries(currentProvider, currentModel);
  const lines: string[] = [];
  lines.push("范围      : 全部模型提供商（按服务商分组 · Codex Router 增强）");
  let totalIdx = 1;

  for (const section of sections) {
    const cred = isProviderCredentialReady(section.providerId, env);
    const currBadge = section.isCurrent ? " ★ 当前" : ` [${cred.badge}]`;
    lines.push(`\n[${section.displayName}${currBadge}]`);

    for (const entry of section.entries) {
      const isCur = section.isCurrent && entry.model.toLowerCase() === (currentModel ?? "").toLowerCase();
      const marker = isCur ? "✔" : " ";
      const desc = getModelDescription(entry.model, section.displayName);
      lines.push(`${marker} ${String(totalIdx++).padStart(3, " ")}. ${entry.model.padEnd(28)} (${desc})`);
    }
  }

  return lines;
}
