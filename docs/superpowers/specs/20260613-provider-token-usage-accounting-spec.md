# Spec: Provider token usage accounting

Qling statusline, `/context`, checkpoints, and goal baselines all depend on `AgentLoop.sessionTokens`. The current loop estimates each model call from prompt string lengths before the API call. That is acceptable as a fallback, but when an OpenAI-compatible provider returns `usage.total_tokens`, the provider value is more authoritative and should be used.

## Goals

- `chat()` must preserve provider token usage from `response.data.usage.total_tokens` when it is a positive finite number.
- `AgentLoop.run()` must add provider-reported total tokens for the model call when available.
- If provider usage is missing or invalid, keep the existing local estimate fallback.
- Token accounting must continue to update `TokenBudgetManager`, session stats, statusline, `/context`, checkpoints, and goal baselines through the existing `sessionTokens` source.

## Non-goals

- Do not add tokenizer dependencies in this change.
- Do not change session snapshot schema.
- Do not expose prompt bodies or request payloads in reports.
- Do not treat provider usage as a hard billing guarantee; it is the best available local accounting source.

## Verification

- Unit test proves provider `usage.total_tokens` overrides the old estimate path.
- Unit test proves missing provider usage still falls back to a positive local estimate.
- `npm run build && node --test tests\unit\agent-loop-tool-args.test.mjs`
- `npm run ci:check`
