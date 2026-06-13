# Plan: Provider token usage accounting

1. Add RED tests around `AgentLoop.run()` with a mocked `client.post()` response that includes `usage.total_tokens`.
2. Add a fallback test for responses without usage to preserve existing behavior.
3. Extend `chat()` return shape with optional `usage.totalTokens`.
4. Move token accounting after `chat()` so the loop can prefer provider usage and fall back to the old estimate.
5. Run targeted tests, full CI, old-name scan, diff review, staged safety checks, commit, and push.

## Risk Notes

- Some OpenAI-compatible providers omit `usage` or return partial fields. The implementation must ignore invalid values rather than corrupting local stats.
- This changes only accounting; it does not alter prompt construction, memory persistence, or model behavior.
