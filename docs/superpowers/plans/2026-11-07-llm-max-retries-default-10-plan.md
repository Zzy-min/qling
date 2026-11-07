# Implementation Plan - Set Default LLM Max Retries to 10

- **Date**: 2026-11-07
- **Target**: `qling` repository (`C:/Users/Lenovo/projects/qling`)
- **Spec**: [`docs/superpowers/specs/2026-11-07-llm-max-retries-default-10-spec.md`](file:///C:/Users/Lenovo/projects/qling/docs/superpowers/specs/2026-11-07-llm-max-retries-default-10-spec.md)

## 1. Objectives & Scope

Increase the default model call retry limit in `qling` from `3` to `10`:
1. In `src/config.ts`:
   - `buildDefaultConfig().llm.max_retries`: change `3` -> `10`.
   - `applyConfigToProcessEnv()`: change `config.llm.max_retries ?? 3` -> `config.llm.max_retries ?? 10`.
2. Ensure config resolution & environment propagation defaults to 10 when unset.
3. Verify test coverage in `tests/unit/config.test.mjs` and retry-related unit tests.

## 2. Proposed Changes

### `src/config.ts`
- Line ~291:
  ```ts
  llm: {
    ...
    max_retries: 10,
    ...
  }
  ```
- Line ~666:
  ```ts
  process.env.QLING_LLM_MAX_RETRIES = String(config.llm.max_retries ?? 10);
  ```

### Tests
- Check `tests/unit/config.test.mjs` or add an assertion ensuring `buildDefaultConfig().llm.max_retries === 10` and `applyConfigToProcessEnv` sets `QLING_LLM_MAX_RETRIES` to `"10"`.
- Run all model retry unit tests:
  - `tests/unit/model-retry.test.mjs`
  - `tests/unit/model-retry-agent.test.mjs`
  - `tests/unit/model-retry-llm.test.mjs`

## 3. Verification Steps

1. Run TypeScript build: `npm run build`
2. Run test suite: `node --test tests/unit/config.test.mjs tests/unit/model-retry.test.mjs tests/unit/model-retry-agent.test.mjs tests/unit/model-retry-llm.test.mjs`
3. Document verification output in `docs/superpowers/reviews/2026-11-07-llm-max-retries-default-10-review.md`.
