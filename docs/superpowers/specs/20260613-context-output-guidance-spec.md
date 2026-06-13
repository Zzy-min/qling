# Context Output Guidance Spec

## Background

Qling already prints token usage and token source in `/context`, but the output still requires users to interpret raw numbers. The active product goal asks for better output standards and accurate token accounting, so context output should translate token usage into an explicit local status and next action.

## Goal

Make `/context` and `qling context` easier to act on by adding a local context health level, a concise recommendation, and a token source explanation.

## User Contract

- Context reports include a `contextLevel`:
  - `unknown` when max token budget is unavailable.
  - `ok` below 70% of budget.
  - `watch` from 70% through 89%.
  - `critical` at 90% or above.
- Formatted output includes:
  - `上下文状态`
  - `建议`
  - `Token 说明`
- Provider token usage is described as provider-reported.
- Estimate token usage is described as local estimate, not exact billing.
- Unknown token usage is described as unavailable/unknown.
- Output remains local-only and does not print message bodies.

## Non-Goals

- No tokenizer dependency.
- No changes to compaction behavior.
- No saved session schema migration.
