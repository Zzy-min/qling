import { loadActiveProfile, resolveProfileCredential } from '../auth/service.js';
import { CHATGPT_ENDPOINT, GROK_ENDPOINT, validateProfile } from '../auth/types.js';
export const AUTH_MARKER_PREFIX = 'qling-auth:';
export function isManagedProvider(provider?: string): boolean {
  return provider === 'chatgpt' || provider === 'grok-account';
}
/** Resolve only the explicitly selected active account, never an API billing credential. */
export async function managedRequestHeaders(options: {
  provider?: string; endpoint: string; apiKey?: string; authStateDir?: string;
}, signal?: AbortSignal, rejectedAccessToken?: string): Promise<Record<string, string>> {
  const managed = isManagedProvider(options.provider);
  const marker = options.apiKey?.startsWith(AUTH_MARKER_PREFIX);
  if (!managed) {
    if (marker) throw Error('Reserved account credential marker; run qling login');
    return options.apiKey && options.apiKey !== 'local' ? { Authorization: `Bearer ${options.apiKey}` } : {};
  }
  const expected = options.provider === 'chatgpt' ? CHATGPT_ENDPOINT : GROK_ENDPOINT;
  if (options.endpoint !== expected || !marker || !options.authStateDir) {
    throw Error('Account connection requires its official endpoint and active profile; run qling login');
  }
  const profile = await loadActiveProfile(options.authStateDir);
  if (!profile || profile.id !== options.apiKey!.slice(AUTH_MARKER_PREFIX.length) ||
    profile.provider !== options.provider || profile.endpoint !== expected) {
    throw Error('Account connection changed or needs login; run qling login');
  }
  validateProfile(profile);
  const credential = await resolveProfileCredential(options.authStateDir, profile, { signal, rejectedAccessToken });
  if (!credential || credential.startsWith(AUTH_MARKER_PREFIX)) throw Error('Account needs login; run qling login');
  return {
    Authorization: `Bearer ${credential}`,
    ...(options.provider === 'grok-account' ? { 'X-XAI-Token-Auth': 'xai-grok-cli' } : {}),
  };
}
