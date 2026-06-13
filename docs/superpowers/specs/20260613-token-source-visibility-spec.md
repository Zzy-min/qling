# Spec: Token source visibility

Provider token accounting is now preferred when `usage.total_tokens` is available, but the UI still prints a bare token count. When a provider omits usage and Qling falls back to local estimation, showing the value as exact is misleading. Local UI surfaces should show the accounting source without leaking message bodies or request payloads.

## Goals

- `AgentLoop.getSessionStats()` exposes a `tokenSource` field: `provider`, `estimate`, or `unknown`.
- Provider `usage.total_tokens` sets the current source to `provider`.
- Local fallback accounting sets the current source to `estimate`.
- `/context` output shows the token source.
- Statusline output shows the token source compactly.

## Non-goals

- Do not change saved session snapshot schema.
- Do not persist token source across process restarts.
- Do not add tokenizer dependencies.
- Do not print prompt, response, or session body content.

## Verification

- Agent loop unit tests cover provider and fallback sources.
- Context report unit tests cover formatted token source.
- Statusline unit tests cover compact token source display.
- `npm run build && node --test tests\unit\agent-loop-tool-args.test.mjs tests\unit\context-report.test.mjs tests\unit\statusline.test.mjs`
- `npm run ci:check`
