// ============================================================
// Phase 4.1 — 可选 LLM 评测任务（默认 skip，不进 ci:check）
// 启用：QLING_EVAL_LLM=1 且具备 API key
// ============================================================

import axios from "axios";
import type { EvalTask, EvalTaskContext } from "./types.js";

function resolveApiKey(env: NodeJS.ProcessEnv): string {
  return (
    env.QLING_LLM_API_KEY ||
    env.DEEPSEEK_API_KEY ||
    env.OPENAI_API_KEY ||
    ""
  ).trim();
}

function llmEvalEnabled(env: NodeJS.ProcessEnv): boolean {
  const raw = String(env.QLING_EVAL_LLM ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

function resolveEndpoint(env: NodeJS.ProcessEnv): string {
  return (
    env.QLING_LLM_ENDPOINT ||
    env.OPENAI_BASE_URL ||
    env.DEEPSEEK_BASE_URL ||
    "https://api.deepseek.com"
  ).replace(/\/$/, "");
}

function resolveModel(env: NodeJS.ProcessEnv): string {
  return env.QLING_LLM_MODEL || "deepseek-chat";
}

export function resolveChatCompletionsUrl(endpoint: string): string {
  const normalized = endpoint.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  if (/\/v1$/i.test(normalized)) return `${normalized}/chat/completions`;
  return `${normalized}/v1/chat/completions`;
}

export function isExactQok(content: string): boolean {
  return content.trim().toLowerCase() === "qok";
}

export function buildEvalLlmTasks(): EvalTask[] {
  return [
    {
      id: "llm-gate-enabled",
      title: "LLM eval 开关与密钥门禁",
      run: async ({ env }) => {
        if (!llmEvalEnabled(env)) {
          return {
            ok: true,
            skip: true,
            detail: "QLING_EVAL_LLM 未开启；跳过真实 LLM 评测",
          };
        }
        if (!resolveApiKey(env)) {
          return {
            ok: true,
            skip: true,
            detail: "无 API key（QLING_LLM_API_KEY / DEEPSEEK_API_KEY / OPENAI_API_KEY）",
          };
        }
        return {
          ok: true,
          detail: `enabled model=${resolveModel(env)} endpoint=${resolveEndpoint(env)}`,
        };
      },
    },
    {
      id: "llm-chat-connectivity",
      title: "LLM chat 连通性（固定短语）",
      run: async (ctx) => {
        const gate = await gateOrSkip(ctx);
        if (gate) return gate;

        const env = ctx.env;
        const apiKey = resolveApiKey(env);
        const endpoint = resolveEndpoint(env);
        const model = resolveModel(env);
        const url = resolveChatCompletionsUrl(endpoint);

        try {
          const resp = await axios.post(
            url,
            {
              model,
              messages: [
                {
                  role: "user",
                  content:
                    'Reply with exactly the three letters QOK and nothing else. No punctuation.',
                },
              ],
              max_tokens: 16,
              temperature: 0,
            },
            {
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              timeout: 45_000,
            }
          );

          const content = String(
            resp.data?.choices?.[0]?.message?.content ?? ""
          ).trim();
          const ok = isExactQok(content);
          return {
            ok,
            detail: `model=${model} reply=${JSON.stringify(content).slice(0, 120)}`,
          };
        } catch (err) {
          return {
            ok: false,
            detail: err instanceof Error ? err.message : String(err),
          };
        }
      },
    },
  ];
}

async function gateOrSkip(
  ctx: EvalTaskContext
): Promise<{ ok: true; skip: true; detail: string } | null> {
  if (!llmEvalEnabled(ctx.env)) {
    return {
      ok: true,
      skip: true,
      detail: "QLING_EVAL_LLM 未开启",
    };
  }
  if (!resolveApiKey(ctx.env)) {
    return {
      ok: true,
      skip: true,
      detail: "missing API key",
    };
  }
  return null;
}
