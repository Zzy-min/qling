# Plan: Token source visibility

1. Add RED tests for `tokenSource` on provider usage and fallback accounting.
2. Add RED tests for `/context` formatting and statusline formatting.
3. Track a non-persistent `tokenUsageSource` in `AgentLoop`.
4. Surface the source from `getSessionStats()` and local formatters.
5. Run targeted tests, full CI, old-name scan, diff review, staged safety checks, commit, and push.

## Risk Notes

- Older mocks and restored snapshots will not have a token source. They should degrade to `unknown`.
- The source is current-process metadata only; saved sessions still preserve the numeric token count exactly as before.
