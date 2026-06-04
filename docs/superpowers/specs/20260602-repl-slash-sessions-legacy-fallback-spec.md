# Classic REPL Slash Sessions Legacy Fallback Spec

## Background

Classic REPL builds a slash command context for `/sessions`. That context currently always provides `listSavedSessions`, implemented as `this.agent.listSessionsDetailed()`. If the agent does not expose `listSessionsDetailed()` but still exposes legacy `listSessions()`, `/sessions` bypasses the command-level fallback path and can throw instead of showing a local session list.

This is a stability issue in the interactive surface: legacy session listing works, but slash session listing can fail in the same REPL when the detailed API is absent.

## User Journey

As a Qling user in classic REPL, I want `/sessions` to remain usable even when only the legacy local session list API is available, so that command style changes do not crash the session manager.

## Requirements

1. Classic REPL `/sessions` must not throw when `listSessionsDetailed()` is unavailable.
2. If `listSessionsDetailed()` is available, `/sessions` must continue to use it.
3. If only `listSessions()` is available, `/sessions` must display local session names through the existing `/sessions` renderer using synthesized summary fields.
4. The fallback must not read message bodies, call the model, or use the network.
5. Existing legacy `!sessions` fallback behavior must remain compatible.

## Non-Goals

- Change the top-level `qling sessions` command.
- Change session persistence format.
- Add full metadata recovery for legacy-only session names.
- Change `/sessions` output when detailed summaries are available.

## Acceptance Criteria

1. A RED test proves classic REPL `/sessions` with only `listSessions()` currently fails.
2. After implementation, that test shows `/sessions` prints the legacy session name and does not emit errors.
3. Existing `/sessions` detailed metadata tests still pass.
4. `npm run ci:check` passes.
