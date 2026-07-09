// ============================================================
// 轻灵 - Provider 预设（单一真相源）
// setup / /model / doctor 共用，避免各处硬编码分叉
// ============================================================

export interface ProviderPreset {
  /** 稳定 id，用于 /model use <id> */
  id: string;
  /** 展示名（中文优先） */
  displayName: string;
  /** QLING_LLM_PROVIDER 写入值 */
  provider: string;
  endpoint: string;
  model: string;
  keyHint?: string;
  /** 本地/无密钥场景为 false */
  requiresApiKey: boolean;
  tags?: string[];
}

/** setup 数字菜单用的有序列表（1-based 由调用方映射） */
export const PROVIDER_PRESET_ORDER: string[] = [
  "deepseek",
  "dashscope",
  "zhipu",
  "moonshot",
  "minimax",
  "mimo",
  "mimo-token-plan",
  "siliconflow",
  "openai",
  "ollama",
];

const PRESET_MAP: Record<string, ProviderPreset> = {
  deepseek: {
    id: "deepseek",
    displayName: "DeepSeek",
    provider: "deepseek",
    endpoint: "https://api.deepseek.com",
    model: "deepseek-chat",
    requiresApiKey: true,
    tags: ["china", "recommended"],
  },
  dashscope: {
    id: "dashscope",
    displayName: "阿里云百炼 (Qwen)",
    provider: "dashscope",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    keyHint: "阿里云 API Key",
    requiresApiKey: true,
    tags: ["china"],
  },
  zhipu: {
    id: "zhipu",
    displayName: "智谱清言 (GLM)",
    provider: "zhipu",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4",
    keyHint: "智谱 AI Key",
    requiresApiKey: true,
    tags: ["china"],
  },
  moonshot: {
    id: "moonshot",
    displayName: "月之暗面 (Kimi)",
    provider: "moonshot",
    endpoint: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    keyHint: "Kimi API Key",
    requiresApiKey: true,
    tags: ["china"],
  },
  minimax: {
    id: "minimax",
    displayName: "MiniMax (海螺)",
    provider: "minimax",
    endpoint: "https://api.minimaxi.com/v1",
    model: "MiniMax-M2.7",
    keyHint: "MiniMax API Key",
    requiresApiKey: true,
    tags: ["china"],
  },
  mimo: {
    id: "mimo",
    displayName: "Xiaomi MiMo (按量计费)",
    provider: "mimo",
    endpoint: "https://api.xiaomimimo.com/v1",
    model: "MiMo-V2.5-Pro",
    keyHint: "小米 MiMo sk-xxx",
    requiresApiKey: true,
    tags: ["china"],
  },
  "mimo-token-plan": {
    id: "mimo-token-plan",
    displayName: "Xiaomi MiMo (Token Plan 订阅)",
    provider: "mimo",
    endpoint: "https://token-plan-cn.xiaomimimo.com/v1",
    model: "MiMo-V2.5-Pro",
    keyHint: "小米 MiMo tp-xxx",
    requiresApiKey: true,
    tags: ["china"],
  },
  siliconflow: {
    id: "siliconflow",
    displayName: "硅基流动 (SiliconFlow)",
    provider: "siliconflow",
    endpoint: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen2.5-7B-Instruct",
    keyHint: "硅基流动 Key",
    requiresApiKey: true,
    tags: ["china"],
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    provider: "openai",
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4o",
    requiresApiKey: true,
    tags: ["global"],
  },
  ollama: {
    id: "ollama",
    displayName: "本地 Ollama",
    provider: "ollama",
    endpoint: "http://localhost:11434/v1",
    model: "llama3",
    keyHint: "Ollama（可留空）",
    requiresApiKey: false,
    tags: ["local"],
  },
  // 别名：历史 setup 用 local 命名
  local: {
    id: "local",
    displayName: "本地部署 (Ollama)",
    provider: "ollama",
    endpoint: "http://localhost:11434/v1",
    model: "llama3",
    keyHint: "Ollama（可留空）",
    requiresApiKey: false,
    tags: ["local", "alias"],
  },
};

const ALIASES: Record<string, string> = {
  local: "ollama",
  ollama: "ollama",
  "llama": "ollama",
  "openai-compat": "openai",
  qwen: "dashscope",
  kimi: "moonshot",
  glm: "zhipu",
  deepseek: "deepseek",
};

export function listProviderPresets(options: { includeAliases?: boolean } = {}): ProviderPreset[] {
  const includeAliases = options.includeAliases === true;
  const ordered = PROVIDER_PRESET_ORDER.map((id) => PRESET_MAP[id]).filter(Boolean);
  if (includeAliases) {
    return Object.values(PRESET_MAP);
  }
  return ordered;
}

export function getProviderPreset(idOrAlias: string): ProviderPreset | undefined {
  const raw = String(idOrAlias ?? "").trim().toLowerCase();
  if (!raw) return undefined;

  // 数字索引 1..N → 有序列表
  if (/^\d+$/.test(raw)) {
    const index = Number(raw) - 1;
    const ordered = listProviderPresets();
    return ordered[index];
  }

  const canonical = ALIASES[raw] ?? raw;
  if (PRESET_MAP[canonical]) return PRESET_MAP[canonical];
  if (PRESET_MAP[raw]) return PRESET_MAP[raw];

  // 允许用 provider 字段模糊匹配第一个
  return listProviderPresets().find(
    (p) => p.provider.toLowerCase() === raw || p.id.toLowerCase() === raw
  );
}

export function resolveModelCandidates(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of listProviderPresets()) {
    if (!seen.has(p.model)) {
      seen.add(p.model);
      out.push(p.model);
    }
  }
  return out;
}

export function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function apiKeyRequiredForEndpoint(endpoint: string, provider?: string): boolean {
  if (provider && (provider === "ollama" || provider === "local")) return false;
  if (endpoint && isLoopbackEndpoint(endpoint)) return false;
  const preset = provider ? getProviderPreset(provider) : undefined;
  if (preset) return preset.requiresApiKey;
  return true;
}

export function formatPresetTableLines(): string[] {
  const lines: string[] = [];
  const presets = listProviderPresets();
  presets.forEach((p, i) => {
    const key = p.requiresApiKey ? "key" : "no-key";
    lines.push(
      `${String(i + 1).padStart(2, " ")}. ${p.id.padEnd(16)} ${p.displayName}`
    );
    lines.push(`    provider=${p.provider}  model=${p.model}`);
    lines.push(`    endpoint=${p.endpoint}  (${key})`);
  });
  return lines;
}
