# Context Output Guidance Plan

## Steps

1. Add context report unit tests for usage levels, recommendations, and token source explanations.
2. Add regression coverage that `memory` focused help advertises `sources`.
3. Extend `ContextReport` with local-only derived fields.
4. Update `formatContextReport` to print the new fields without message bodies.
5. Update `help-topics.ts` memory examples/usages.
6. Run targeted tests, full CI, old-name scan, whitespace check, audit, then commit and push.

## Risk Controls

- Derive levels only from existing `tokens` and `maxTokens`.
- Treat missing budgets as unknown instead of inventing a threshold.
- Do not read extra files or message bodies.
