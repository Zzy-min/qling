export type AuthMethod =
  | "api_key"
  | "chatgpt_oauth"
  | "grok_cli_session"
  | "none";
export interface AuthProfile {
  id: string;
  provider: string;
  method: AuthMethod;
  endpoint: string;
  model: string;
}
export interface AuthCredential {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  expiresAt?: number;
  clientId?: string;
  idToken?: string;
  scopes?: string[];
  subject?: string;
  issuer?: string;
}
export interface CredentialCipher {
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
}
export const CHATGPT_ENDPOINT = "https://api.openai.com/v1";
export const GROK_ENDPOINT = "https://cli-chat-proxy.grok.com/v1";
export function validateProfile(p: AuthProfile): void {
  if (!p || !/^[a-zA-Z0-9_-]{1,160}$/.test(p.id) || !p.provider || !p.model)
    throw Error("Invalid auth profile");
  const u = new URL(p.endpoint);
  if (u.username || u.password || u.search || u.hash)
    throw Error("Invalid endpoint");
  if (
    p.method === "chatgpt_oauth" &&
    (p.provider !== "chatgpt" || p.endpoint !== CHATGPT_ENDPOINT)
  )
    throw Error("ChatGPT requires its official endpoint");
  if (
    p.method === "grok_cli_session" &&
    (p.provider !== "grok-account" || p.endpoint !== GROK_ENDPOINT)
  )
    throw Error("Grok requires its official endpoint");
  if (
    !["api_key", "chatgpt_oauth", "grok_cli_session", "none"].includes(p.method)
  )
    throw Error("Unsupported auth method");
  if (
    ["chatgpt", "grok-account"].includes(p.provider) &&
    !["chatgpt_oauth", "grok_cli_session"].includes(p.method)
  )
    throw Error("Account provider requires account auth");
}
