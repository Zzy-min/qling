# Slash Self-Correction Plan

## Steps

1. Add RED tests for typo suggestions and weak fallback wording.
2. Update `formatUnknownSlashCommandMessage` only; keep command resolution unchanged.
3. Verify targeted slash command tests.
4. Run full CI, old-name scan, diff check, audit, staged checks.
5. Commit and push to `origin/main`.

## Risk Controls

- Do not auto-run suggestions.
- Do not use model calls.
- Preserve existing suggestion thresholds and aliases.
