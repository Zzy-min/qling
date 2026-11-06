import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import {
  authPath,
  privateDir,
  atomicWrite,
  readJson,
  platformCipher,
} from "./store.js";
import {
  validateProfile,
  GROK_ENDPOINT,
  type AuthProfile,
  type AuthCredential,
  type CredentialCipher,
} from "./types.js";
import {
  authorizeChatGpt,
  refreshChatGpt,
  type HttpFetch,
  type ChatGptLoginOptions,
} from "./chatgpt.js";
import { readGrokCredential, runOfficialGrokLogin } from "./grok.js";
interface Entry {
  profile: AuthProfile;
  credentialFile?: string;
}
interface Connections {
  version: 1;
  activeId: string | null;
  entries: Record<string, Entry>;
}
interface Dependencies {
  cipher?: CredentialCipher;
  http?: HttpFetch;
  readGrokCredential?: () => Promise<AuthCredential>;
}
const locks = new Map<string, Promise<unknown>>();
async function locked<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prior = locks.get(key) || Promise.resolve();
  const work = prior.catch(() => {}).then(task);
  locks.set(key, work);
  try {
    return await work;
  } finally {
    if (locks.get(key) === work) locks.delete(key);
  }
}
export function createAuthService(deps: Dependencies = {}) {
  const cipher = deps.cipher || platformCipher,
    http = deps.http || fetch;
  const read = (dir: string) =>
    readJson<Connections>(join(authPath(dir), "connections.json"), {
      version: 1,
      activeId: null,
      entries: {},
    }).then((s) => {
      if (s.version !== 1 || !s.entries)
        throw Error("Unsupported auth state version");
      return s;
    });
  const persist = (dir: string, s: Connections) =>
    atomicWrite(join(authPath(dir), "connections.json"), JSON.stringify(s));
  const retireSecret = async (dir: string, file?: string): Promise<void> => {
    if (!file) return;
    if (!/^credential-[a-f0-9-]+\.json$/.test(file))
      throw Error("Unsafe credential reference");
    try {
      await unlink(join(authPath(dir), file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error("Cannot remove retired Qling credential");
    }
  };
  const secret = async (dir: string, e: Entry): Promise<AuthCredential> => {
    if (
      !e.credentialFile ||
      !/^credential-[a-f0-9-]+\.json$/.test(e.credentialFile)
    )
      throw Error("needs_login: missing stored credential");
    const data = await readJson<{
      payload: string;
    }>(join(authPath(dir), e.credentialFile));
    try {
      return JSON.parse(await cipher.decrypt(data.payload)) as AuthCredential;
    } catch {
      throw Error("Cannot decrypt credential for current user");
    }
  };
  const writeSecret = async (dir: string, c: AuthCredential) => {
    const file = `credential-${randomUUID()}.json`;
    await atomicWrite(
      join(authPath(dir), file),
      JSON.stringify({ payload: await cipher.encrypt(JSON.stringify(c)) }),
    );
    return file;
  };
  const loadActiveProfile = async (
    dir: string,
  ): Promise<AuthProfile | null> => {
    const s = await read(dir);
    const p = s.activeId ? s.entries[s.activeId]?.profile : null;
    if (p) validateProfile(p);
    return p || null;
  };
  const saveConnection = async (
    dir: string,
    p: AuthProfile,
    c?: AuthCredential,
  ): Promise<void> => {
    validateProfile(p);
    await locked(resolve(dir), async () => {
      await privateDir(authPath(dir));
      const s = await read(dir);
      const clean: AuthProfile = {
        id: p.id,
        provider: p.provider,
        method: p.method,
        endpoint: p.endpoint,
        model: p.model,
      };
      if (p.method !== "none" && !c && p.method !== "grok_cli_session")
        throw Error("Missing connection credential");
      const credentialFile = c ? await writeSecret(dir, c) : undefined;
      const retired = s.entries[p.id]?.credentialFile;
      s.entries[p.id] = { profile: clean, credentialFile };
      s.activeId = p.id;
      try {
        await persist(dir, s);
      } catch (error) {
        await retireSecret(dir, credentialFile);
        throw error;
      }
      await retireSecret(dir, retired);
    });
  };
  const resolveProfileCredential = async (
    dir: string,
    p: AuthProfile,
    options?: {
      signal?: AbortSignal;
      /** Refresh only if this rejected token is still current under the profile lock. */
      rejectedAccessToken?: string;
    },
  ): Promise<string> => {
    validateProfile(p);
    options?.signal?.throwIfAborted();
    return locked(`${resolve(dir)}:${p.id}`, async () => {
      const s = await read(dir),
        e = s.entries[p.id];
      if (
        s.activeId !== p.id ||
        !e ||
        JSON.stringify(e.profile) !==
          JSON.stringify({
            id: p.id,
            provider: p.provider,
            method: p.method,
            endpoint: p.endpoint,
            model: p.model,
          })
      )
        throw Error("Auth profile mismatch; select a connection");
      if (p.method === "none") return "";
      if (p.method === "grok_cli_session") {
        const c = await (deps.readGrokCredential || readGrokCredential)();
        options?.signal?.throwIfAborted();
        return c.accessToken!;
      }
      let c = await secret(dir, e);
      if (p.method === "api_key") {
        if (!c.apiKey) throw Error("Missing API key");
        return c.apiKey;
      }
      if (
        !c.scopes?.includes("chatgpt.tokens.use.direct") ||
        !c.scopes.includes("resource.invoke")
      )
        throw Error("needs_login: insufficient ChatGPT scopes");
      if (!c.expiresAt || c.expiresAt <= Date.now() + 60000 ||
          (options?.rejectedAccessToken && c.accessToken === options.rejectedAccessToken)) {
        c = await refreshChatGpt(http, c, options?.signal);
        options?.signal?.throwIfAborted();
        await locked(resolve(dir), async () => {
          const latest = await read(dir);
          // A login, account switch or logout during the request must win over stale refresh work.
          if (
            latest.activeId !== p.id ||
            latest.entries[p.id]?.credentialFile !== e.credentialFile
          )
            throw Error("Auth profile changed during refresh");
          const replacement = await writeSecret(dir, c);
          latest.entries[p.id].credentialFile = replacement;
          try {
            await persist(dir, latest);
          } catch (error) {
            await retireSecret(dir, replacement);
            throw error;
          }
          await retireSecret(dir, e.credentialFile);
        });
      }
      if (!c.accessToken) throw Error("needs_login: missing access token");
      return c.accessToken;
    });
  };
  const loginChatGpt = async (options: ChatGptLoginOptions) => {
    let previous: AuthCredential | undefined;
    const s = await read(options.stateDir);
    const e = s.activeId ? s.entries[s.activeId] : undefined;
    if (e?.profile.method === "chatgpt_oauth")
      previous = await secret(options.stateDir, e);
    return authorizeChatGpt(options, http, previous);
  };
  const loginGrok = async (options: {
    stateDir: string;
    signal?: AbortSignal;
    runLogin?: () => Promise<void>;
  }) => {
    options.signal?.throwIfAborted();
    await (options.runLogin
      ? options.runLogin()
      : runOfficialGrokLogin(options.signal));
    options.signal?.throwIfAborted();
    await (deps.readGrokCredential || readGrokCredential)();
    return {
      profile: {
        id: randomUUID(),
        provider: "grok-account",
        method: "grok_cli_session" as const,
        endpoint: GROK_ENDPOINT,
        model: "grok-build",
      },
    };
  };
  const logoutProfile = async (dir: string, provider?: string) =>
    locked(resolve(dir), async () => {
      const s = await read(dir);
      if (!s.activeId) return;
      const e = s.entries[s.activeId];
      if (provider && e?.profile.provider !== provider) return;
      delete s.entries[s.activeId];
      s.activeId = null;
      await persist(dir, s);
      await retireSecret(dir, e?.credentialFile);
    });
  return {
    loadActiveProfile,
    saveConnection,
    resolveProfileCredential,
    loginChatGpt,
    loginGrok,
    logoutProfile,
  };
}
const service = createAuthService();
export const {
  loadActiveProfile,
  saveConnection,
  resolveProfileCredential,
  loginChatGpt,
  loginGrok,
  logoutProfile,
} = service;
