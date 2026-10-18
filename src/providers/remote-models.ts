import type { QlingConfig } from "../config.js";
import { presetsForProvider, providerModelNames, resolveModelCandidates } from "./presets.js";
import { endpointHost } from "./resolve-llm.js";

export interface RemoteModelList {
  ok: boolean;
  models: string[];
  warning?: string;
}

export async function listRemoteModels(options: {
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<RemoteModelList> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = String(options.endpoint ?? "").trim().replace(/\/+$/, "");
  if (!base) {
    return { ok: false, models: [], warning: "GET /models 失败，已改用预设列表" };
  }
  const url = `${base}/models`;
  const timeoutMs = options.timeoutMs ?? 5000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    const apiKey = String(options.apiKey ?? "").trim();
    if (apiKey && apiKey !== "local") headers.Authorization = `Bearer ${apiKey}`;
    const response = await fetchImpl(url, { method: "GET", headers, signal: controller.signal });
    if (!response.ok) {
      return { ok: false, models: [], warning: `GET /models HTTP ${response.status}，已改用预设列表` };
    }
    const body = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = [...new Set((body.data ?? []).map((item) => String(item.id ?? "").trim()).filter(Boolean))];
    if (models.length === 0) {
      return { ok: false, models: [], warning: "远端未返回模型，已改用预设列表" };
    }
    return { ok: true, models };
  } catch {
    return { ok: false, models: [], warning: "GET /models 失败，已改用预设列表" };
  } finally {
    clearTimeout(timer);
  }
}

export async function runModelsCli(
  args: string[],
  config: Pick<QlingConfig, "llm">,
  _env: NodeJS.ProcessEnv = process.env,
  fetchImpl?: typeof fetch,
): Promise<number> {
  const showAll = args.includes("--all");
  const provider = String(config.llm.provider ?? "");
  const currentModel = String(config.llm.model ?? "");
  const host = endpointHost(config.llm.endpoint) || "-";
  const unknownProvider = presetsForProvider(provider).length === 0;
  let models: string[];
  let source = "preset";

  if (showAll) {
    // Preset models only. Do not call other hosts and do not read other providers' keys.
    models = resolveModelCandidates();
  } else if (args.includes("--local") || args.includes("--preset")) {
    models = providerModelNames(provider, currentModel);
    if (unknownProvider) {
      console.error("提示: 未知服务商，没有预设模型。用 /model use <preset> 切换。");
    }
  } else {
    const remote = await listRemoteModels({
      endpoint: config.llm.endpoint,
      apiKey: config.llm.api_key,
      timeoutMs: 5000,
      fetchImpl,
    });
    if (remote.ok) {
      models = remote.models;
      source = "remote";
    } else {
      models = providerModelNames(provider, currentModel);
      if (unknownProvider) {
        const reason = remote.warning || "远端模型不可用";
        console.error(`提示: 未知服务商，${reason}。用 /model use <preset> 切换。`);
      } else if (remote.warning) {
        console.error(`Warning: ${remote.warning}`);
      }
    }
  }

  const scope = showAll ? "all" : "provider";
  console.log(`models host=${host} source=${source} provider=${provider} scope=${scope}`);
  for (const model of models) console.log(model);
  return 0;
}
