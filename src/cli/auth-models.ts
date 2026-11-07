import { validateProfile, type AuthProfile, type AuthCredential } from "../auth/types.js";
import { readGrokCredential } from "../auth/grok.js";
import type { RemoteModelList } from "../providers/remote-models.js";
/** Pending account only: fixed official origin, no activation/refresh/inference. */
export async function listPendingAccountModels(profile: AuthProfile, credential?: AuthCredential,
  options: { signal?: AbortSignal; fetchImpl?: typeof fetch; readGrok?: typeof readGrokCredential } = {}): Promise<RemoteModelList> {
  validateProfile(profile);
  if (!["chatgpt_oauth", "grok_cli_session"].includes(profile.method)) return { ok: false, models: [] };
  const signal = AbortSignal.any([AbortSignal.timeout(5000), ...(options.signal ? [options.signal] : [])]);
  try {
    options.signal?.throwIfAborted();
    const c = profile.method === "grok_cli_session" ? await (options.readGrok ?? readGrokCredential)() : credential;
    options.signal?.throwIfAborted();
    if (!c?.accessToken) return { ok: false, models: [] };
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${c.accessToken}` };
    if (profile.method === "grok_cli_session") { headers["X-XAI-Token-Auth"] = "xai-grok-cli"; headers["x-grok-model-override"] = profile.model; }
    const response = await (options.fetchImpl ?? fetch)(`${profile.endpoint}/models`, { headers, signal, redirect: "error" });
    if (!response.ok) return { ok: false, models: [] };
    const body = await response.json() as { models?: { slug?: string; visibility?: string }[]; data?: { id?: string }[] };
    const ids = profile.method === "chatgpt_oauth" && Array.isArray(body.models)
      ? body.models.filter(m => m.visibility === "list").map(m => m.slug)
      : (body.data ?? []).map(m => m.id);
    const models = [...new Set(ids.filter((m): m is string => typeof m === "string" && Boolean(m.trim())).map(m => m.trim()))];
    options.signal?.throwIfAborted();
    return { ok: models.length > 0, models };
  } catch { options.signal?.throwIfAborted(); return { ok: false, models: [] }; }
}
