# Product Experience Bootstrap Plan

## Steps

1. Add tests for bootstrap routing, bootstrap report formatting, doctor recommendations, CLI error panel, top-level help, and TUI first-run copy.
2. Implement `src/cli/bootstrap.ts` with pure parsing/report helpers and a local `runBootstrap()` runner.
3. Add `scripts/bootstrap.mjs` and wire `npm run bootstrap`.
4. Register `bootstrap` in the CLI startup contract, help output, Chinese alias, and `index.ts`.
5. Simplify `runSetup()` around quick defaults and move advanced feature prompts behind one opt-in.
6. Replace onboarding tutorial with a concise non-blocking card and update TUI placeholder/hints.
7. Update doctor recommendations and README quick start.
8. Run build, targeted tests, ci check, old-name scan, diff check, and audit.

## Constraints

- Do not change model invocation, storage schema, daemon/dashboard semantics, or slash command execution.
- Keep secrets redacted in all new output.
- Bootstrap must be useful even when no API key is configured; it should guide, not fail hard.
