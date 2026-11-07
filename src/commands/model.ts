import type { SlashCommand } from "./types.js";
import type { SlashCommandContext } from "./runtime.js";
import {
  formatAllGroupedProviderModelLines,
  formatProviderModelLines,
  getProviderPreset,
  listAllGroupedProviderModelEntries,
  listProviderModelEntries,
  lookupModelWindow,
  lookupRetiredModel,
  presetsForProvider,
  providerModelNames,
} from "../providers/presets.js";
import {
  activePresetIds,
  endpointHost,
  isSameLlmTarget,
  isProviderCredentialReady,
  resolveProviderApiKey,
  validateModelName,
} from "../providers/resolve-llm.js";
import { listRemoteModels } from "../providers/remote-models.js";
import { inspectActiveConnection, resolveProfileCredential } from "../auth/service.js";
import { AUTH_MARKER_PREFIX } from "../providers/managed-auth.js";
import { captureGenericCredentialOrigin, normalizeLlmEndpoint, isUsableApiKey } from "../providers/resolve-llm.js";
import { openOptionPickerOrFallback } from "../tui/option-picker-helpers.js";
import {
  buildGroupedModelPickerSpec,
  formatGroupedModelPickerLines,
} from "../tui/model-picker.js";

export const modelCommand: SlashCommand = {
  name: "/model",
  description: "切换器选择模型 / Provider 预设 (Codex Router 增强)",
  usage: "/model [list [--all|--current|--remote]|use <preset>|<model>|status]",
  category: "session",
  argumentHint: "[list [--all|--current|--remote]|use <preset>|<model>|status]",
  availability: "local",
  claudeCompatibleName: "/model",
  execute: async (args: string[], context: SlashCommandContext) => {
    const loop = context.agentLoop as any;
    const currentModel =
      typeof loop?.getModel === "function"
        ? loop.getModel()
        : process.env.QLING_LLM_MODEL || "unknown";
    const currentProvider =
      typeof loop?.getProvider === "function"
        ? loop.getProvider()
        : process.env.QLING_LLM_PROVIDER || "unknown";
    const currentEndpoint =
      typeof loop?.getEndpoint === "function"
        ? loop.getEndpoint()
        : process.env.QLING_LLM_ENDPOINT || "unknown";

    const sub = (args[0] ?? "").trim().toLowerCase();
    const rest = args.slice(1).join(" ").trim();

    const endpointLabel = endpointHost(currentEndpoint) || currentEndpoint;
    const sources = typeof loop?.getLlmFieldSources === "function" ? loop.getLlmFieldSources() : null;
    const sessionKey = typeof loop?.getApiKey === "function" ? String(loop.getApiKey() ?? "") : "";
    const unknownProvider = presetsForProvider(currentProvider).length === 0;
    let showCatalogHint = true;
    const stateDir = loop?.getRuntimeRootDir?.();
    captureGenericCredentialOrigin(process.env, currentProvider, currentEndpoint);
    const connection = stateDir ? await inspectActiveConnection(stateDir) : undefined;
    const evidence = { currentProvider, currentEndpoint, sessionApiKey: sessionKey, connection };
    const resolveConnectionKey = async (provider: string, endpoint: string): Promise<string | null> => {
      const latest = stateDir ? await inspectActiveConnection(stateDir) : undefined;
      const profile = latest?.profile;
      const sameTarget = provider === currentProvider && normalizeLlmEndpoint(endpoint) === normalizeLlmEndpoint(currentEndpoint);
      const managed = provider === "chatgpt" || provider === "grok-account";
      if (!managed && sameTarget && isUsableApiKey(sessionKey)) return sessionKey;
      const resolved = resolveProviderApiKey(provider, process.env, {
        ...evidence, endpoint, sameProvider: false,
        startupProvider: loop?.getStartupProvider?.() ?? currentProvider,
      });
      if (!managed && !resolved.refused && isUsableApiKey(resolved.apiKey)) return resolved.apiKey;
      if (profile?.provider === provider && normalizeLlmEndpoint(profile.endpoint) === normalizeLlmEndpoint(endpoint) && latest?.status === "ready") {
        if (profile.method === "chatgpt_oauth" || profile.method === "grok_cli_session") return AUTH_MARKER_PREFIX + profile.id;
        if (profile.method === "none") return "";
        try {
          const key = await resolveProfileCredential(stateDir, profile);
          if (isUsableApiKey(key)) return key;
        } catch { /* A changed/unavailable vault must not switch the session. */ }
      }
      if (resolved.refused) { context.writeError(`❌ ${resolved.message}`); return null; }
      return resolved.apiKey;
    };

    const applyPreset = async (presetKey: string): Promise<boolean> => {
      const preset = getProviderPreset(presetKey);
      if (!preset) {
        context.writeError(`❌ 未找到预设 '${presetKey}'。`);
        return false;
      }
      const apiKey = await resolveConnectionKey(preset.provider, preset.endpoint);
      if (apiKey === null) return false;
      if (typeof loop?.applyLlmSession === "function") {
        loop.applyLlmSession({
          provider: preset.provider,
          endpoint: preset.endpoint,
          model: preset.model,
          ...(apiKey !== undefined ? { apiKey } : {}),
        });
      } else if (typeof loop?.setModel === "function") {
        loop.setModel(preset.model);
        process.env.QLING_LLM_PROVIDER = preset.provider;
        process.env.QLING_LLM_ENDPOINT = preset.endpoint;
        process.env.QLING_LLM_MODEL = preset.model;
        if (apiKey !== undefined) {
          process.env.QLING_LLM_API_KEY = apiKey;
        }
      } else {
        context.writeError("❌ 当前 AgentLoop 不支持 session 级模型切换。");
        return false;
      }
      await context.onModelChanged?.(preset.model);
      context.writeLine(
        `🤖 ${preset.id} · ${preset.displayName} → ${preset.model}`
      );
      return true;
    };

    const applyModelOnly = async (nextModel: string): Promise<void> => {
      const invalid = validateModelName(nextModel);
      if (invalid) {
        context.writeError(`❌ ${invalid}`);
        return;
      }
      if (typeof loop?.applyLlmSession === "function") {
        loop.applyLlmSession({ model: nextModel });
      } else if (typeof loop?.setModel === "function") {
        loop.setModel(nextModel);
        process.env.QLING_LLM_MODEL = nextModel;
      } else {
        context.writeError("❌ 当前 AgentLoop 不支持 session 级模型切换。");
        return;
      }
      await context.onModelChanged?.(nextModel);
      context.writeLine(`已切换模型: ${currentModel} -> ${nextModel}`);
    };

    const openModelPicker = (
      models?: string[],
      options?: { currentOnly?: boolean; initialQuery?: string }
    ): boolean => {
      if (typeof context.setInputDraft === "function") {
        context.setInputDraft(options?.initialQuery ? String(options.initialQuery) : "");
      }

      // 1. 远端模型列表（如 /model list --remote 成功返回）
      if (models && models.length > 0) {
        const unique = [...new Set(models)];
        let marked = false;
        const items = unique.map((model) => {
          const active = !marked && model === currentModel;
          if (active) marked = true;
          return {
            id: model,
            label: model,
            description: `${currentProvider} · ${endpointLabel}`,
            active,
          };
        });
        return openOptionPickerOrFallback(
          context,
          {
            title: "模型切换 · 远端模型",
            footerHint: "↑/↓ 选择模型 · Enter 应用 · Esc 取消",
            selectedId: items.find((item) => item.active)?.id,
            items,
            onPick: async (item: any) => {
              await applyModelOnly(item.id);
            },
          },
          () => {
            context.writeLine("");
            context.writeLine("🤖 【远端模型】");
            context.writeLine("-----------------------------------------");
            context.writeLine(`当前      : ${currentProvider} · ${currentModel}`);
            context.writeLine(`Endpoint  : ${endpointLabel}`);
            for (const model of unique) context.writeLine(model);
            context.writeLine("-----------------------------------------");
            context.writeLine("");
          }
        );
      }

      // 2. 当前提供商限定选择器（/model list --current）
      const currentOnly = options?.currentOnly === true;
      if (currentOnly) {
        const entries = listProviderModelEntries(currentProvider, currentModel);
        let marked = false;
        const items = entries.map((entry) => {
          const preset = entry.presetId ? getProviderPreset(entry.presetId) : undefined;
          const matchesPreset = preset
            ? isSameLlmTarget(preset, {
                provider: currentProvider,
                endpoint: currentEndpoint,
                model: currentModel,
              })
            : false;
          const active = !marked && (matchesPreset || (!entry.presetId && entry.model === currentModel));
          if (active) marked = true;
          return {
            id: entry.id,
            label: entry.source === "preset" ? entry.label : entry.model,
            description: entry.description,
            active,
          };
        });
        return openOptionPickerOrFallback(
          context,
          {
            title: `模型切换 · ${currentProvider}`,
            footerHint: "↑/↓ 选择当前服务商的模型 · Enter 应用 · Esc 取消",
            selectedId: items.find((item) => item.active)?.id,
            items,
            onPick: async (item: any) => {
              const entry = entries.find((candidate) => candidate.id === item.id);
              if (entry?.presetId) {
                await applyPreset(entry.presetId);
                return;
              }
              await applyModelOnly(entry?.model ?? item.id);
            },
          },
          () => {
            context.writeLine("");
            context.writeLine("🤖 【模型 / Provider】");
            context.writeLine("-----------------------------------------");
            context.writeLine(`当前      : ${currentProvider} · ${currentModel}`);
            context.writeLine(`Endpoint  : ${endpointLabel}`);
            for (const line of formatProviderModelLines(currentProvider, currentModel, { hint: showCatalogHint })) {
              context.writeLine(line);
            }
            context.writeLine("切换: /model use <preset>");
            context.writeLine("-----------------------------------------");
            context.writeLine("");
          }
        );
      }

      // 3. 默认多服务商分组选择器（Codex Router 增强，支持输入实时过滤）
      const pickerSpec = buildGroupedModelPickerSpec({
        currentProvider,
        currentModel,
        currentEndpoint,
        credentialEvidence: evidence,
        callbacks: {
          resolveConnectionKey,
          applyModel: async (model) => {
            await applyModelOnly(model);
          },
          applyPreset: async (presetId) => {
            await applyPreset(presetId);
          },
          applyLlmSession: async (session) => {
            if (typeof loop?.applyLlmSession === "function") {
              loop.applyLlmSession(session);
            } else if (typeof loop?.setModel === "function") {
              loop.setModel(session.model);
              process.env.QLING_LLM_PROVIDER = session.provider;
              process.env.QLING_LLM_ENDPOINT = session.endpoint;
              process.env.QLING_LLM_MODEL = session.model;
              if (session.apiKey !== undefined) {
                process.env.QLING_LLM_API_KEY = session.apiKey;
              }
            }
            await context.onModelChanged?.(session.model);
          },
          writeNotice: (msg) => context.writeLine(msg),
          writeError: (msg) => context.writeError(msg),
          getStartupProvider: () => {
            return typeof loop?.getStartupProvider === "function"
              ? loop.getStartupProvider()
              : currentProvider;
          },
        },
      });

      return openOptionPickerOrFallback(
        context,
        pickerSpec,
        () => {
          context.writeLine("");
          if (allRequested) {
            context.writeLine("🤖 【模型 / Provider（按服务商分组 · Codex Router 增强）】");
          } else {
            context.writeLine("🤖 【模型 / Provider】");
          }
          context.writeLine("-----------------------------------------");
          context.writeLine(`当前      : ${currentProvider} · ${currentModel}`);
          context.writeLine(`Endpoint  : ${endpointLabel}`);
          if (allRequested) {
            for (const line of formatGroupedModelPickerLines(currentProvider, currentModel, process.env, evidence)) {
              context.writeLine(line);
            }
          } else {
            for (const line of formatProviderModelLines(currentProvider, currentModel, { hint: showCatalogHint })) {
              context.writeLine(line);
            }
          }
          context.writeLine("-----------------------------------------");
          context.writeLine("切换: /model use <preset>");
          context.writeLine("");
        }
      );
    };

    const remoteRequested = args.some((arg) => arg === "--remote");
    const currentRequested = args.some((arg) => arg === "--current");
    const allRequested = args.some((arg) => arg === "--all");
    const listing = !sub || sub === "list" || sub === "ls" || sub === "--remote" || sub === "--current" || sub === "--all";

    if (remoteRequested && listing) {
      const remote = await listRemoteModels({
        endpoint: currentEndpoint,
        apiKey: sessionKey,
        provider: currentProvider,
        authStateDir: loop?.getRuntimeRootDir?.(),
        timeoutMs: 5000,
      });
      if (remote.ok) {
        openModelPicker(remote.models);
        return;
      }
      showCatalogHint = false;
      if (unknownProvider) {
        const reason = remote.warning || "远端模型不可用";
        context.writeError(`⚠️ 未知服务商，${reason}。用 /model use <preset> 切换。`);
      } else if (remote.warning) {
        context.writeError(`⚠️ ${remote.warning}`);
      }
      openModelPicker();
      return;
    }

    if (sub === "help" || sub === "--help" || sub === "-h") {
      context.writeLine("");
      context.writeLine("🤖 【/model 命令帮助 (Codex Router 增强)】");
      context.writeLine("-----------------------------------------");
      context.writeLine("用法：");
      context.writeLine("  /model                     - 打开交互式模型选择器（实时过滤、凭据感知）");
      context.writeLine("  /model list                - 列出当前服务商的可用模型");
      context.writeLine("  /model list --all          - 列出所有服务商及模型分组与凭据状态");
      context.writeLine("  /model list --current      - 仅在选择器中展示当前服务商的模型");
      context.writeLine("  /model list --remote       - 向当前端点 /models 获取实时可用模型");
      context.writeLine("  /model status              - 查看当前模型、服务商、窗口与凭据状态");
      context.writeLine("  /model use <preset>        - 切换到指定预设 (如 deepseek, qwen, kimi)");
      context.writeLine("  /model <modelName>         - 切换当前服务商下的模型名称");
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    if (currentRequested && listing) {
      openModelPicker(undefined, { currentOnly: true });
      return;
    }

    if (!sub || sub === "list" || sub === "ls" || sub === "presets" || sub === "pick" || sub === "ui" || sub === "--all") {
      const initialQuery = (sub === "pick" || (sub === "list" && rest && !rest.startsWith("-"))) ? rest : undefined;
      openModelPicker(undefined, { initialQuery });
      return;
    }

    if (sub === "status" || sub === "状态") {
      const active = activePresetIds({
        provider: currentProvider,
        endpoint: currentEndpoint,
        model: currentModel,
      });
      const cred = isProviderCredentialReady(currentProvider, process.env, { ...evidence, endpoint: currentEndpoint });
      const meta = lookupModelWindow(currentModel);

      context.writeLine("");
      context.writeLine("🤖 【模型 / Provider 状态 (Codex Router 增强)】");
      context.writeLine("-----------------------------------------");
      context.writeLine(`Provider  : ${currentProvider}${sources ? ` (${sources.provider})` : ""}`);
      context.writeLine(`Endpoint  : ${endpointLabel}${sources ? ` (${sources.endpoint})` : ""}`);
      context.writeLine(`Model     : ${currentModel}${sources ? ` (${sources.model})` : ""}`);
      if (meta?.contextWindow) {
        context.writeLine(`Context   : ${meta.contextWindow.toLocaleString()} tokens`);
      }
      if (meta?.maxOutputTokens) {
        context.writeLine(`Max Output: ${meta.maxOutputTokens.toLocaleString()} tokens`);
      }
      context.writeLine(`凭据状态  : ${cred.badge}${cred.message ? ` (${cred.message})` : cred.ready ? " (已就绪)" : ""}`);

      const retiredReplacement = lookupRetiredModel(currentModel);
      if (retiredReplacement) {
        context.writeLine(`提示      : 该模型已下线，建议换成 ${retiredReplacement}。`);
      }
      context.writeLine(`候选模型  : ${providerModelNames(currentProvider, currentModel).join(", ")}`);
      if (unknownProvider) {
        context.writeLine("提示      : 未知服务商，没有预设模型。用 /model use <preset> 切换。");
      }
      context.writeLine(`高亮预设  : ${active.length ? active.join(", ") : "无"}`);
      context.writeLine("切换      : /model  （打开分组切换器）");
      context.writeLine("范围      : 会话切换不写入配置文件。");
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }

    if (sub === "use" || sub === "preset") {
      const presetKey = rest || args[1] || "";
      if (!presetKey) {
        openModelPicker();
        return;
      }
      await applyPreset(presetKey);
      return;
    }

    // 兼容：/model <modelName> 仅切换 model
    const nextModel = args.join(" ").trim();
    const invalidModel = validateModelName(nextModel);
    if (invalidModel) {
      context.writeError(`❌ ${invalidModel}`);
      return;
    }
    if (typeof loop?.setModel !== "function" && typeof loop?.applyLlmSession !== "function") {
      context.writeError("❌ 当前 AgentLoop 不支持 session 级模型切换。");
      context.writeLine("-----------------------------------------");
      context.writeLine("");
      return;
    }
    try {
      if (typeof loop?.applyLlmSession === "function") {
        loop.applyLlmSession({ model: nextModel });
      } else {
        loop.setModel(nextModel);
        process.env.QLING_LLM_MODEL = nextModel;
      }
    } catch (err) {
      context.writeError(`❌ ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    await context.onModelChanged?.(nextModel);
    context.writeLine(`已切换模型: ${currentModel} -> ${nextModel}`);
    context.writeLine(`Provider  : ${currentProvider}（未改）`);
    context.writeLine(`Endpoint  : ${currentEndpoint}（未改）`);
    context.writeLine("范围      : 仅当前会话/当前进程，不写入默认配置。");
    context.writeLine("提示      : 换供应商请用 /model use <preset>");
    context.writeLine("-----------------------------------------");
    context.writeLine("");
  },
};
