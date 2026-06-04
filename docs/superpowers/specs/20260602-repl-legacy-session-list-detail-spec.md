# Classic REPL Legacy Session List Detail Spec

## Background

Classic REPL supports both slash commands and legacy commands. `/sessions` already shows saved session metadata including session id, update time, turn count, and message count. Legacy `!sessions` and `!load` without a target still call `listSessions()` and print only bare saved-session names, which makes restoring local sessions less confident and less consistent.

## User Journey

As a Qingling user staying in classic REPL muscle memory, I want `!sessions` and bare `!load` to show the same useful local session summary as `/sessions`, so that I can choose the right local session without switching command styles or guessing from filenames.

## Requirements

1. `!sessions` must prefer `listSessionsDetailed()` when the agent supports it.
2. `!load` with no target must prefer `listSessionsDetailed()` when the agent supports it.
3. Detailed legacy output must include session name, session id, updated time, turn count, and message count.
4. Legacy output must not include message bodies.
5. Agents without `listSessionsDetailed()` must keep the existing `listSessions()` fallback behavior.
6. No model call or network dependency may be introduced.

## Non-Goals

- Change `/sessions` behavior.
- Change session persistence format.
- Change `!load <name>` restore semantics.
- Add pagination or filtering.

## Acceptance Criteria

1. A RED test proves `!sessions` currently ignores `listSessionsDetailed()` and lacks detailed metadata.
2. A RED test proves bare `!load` currently ignores `listSessionsDetailed()` and lacks detailed metadata.
3. Existing legacy fallback test still passes for agents that only expose `listSessions()`.
4. `npm run ci:check` passes after implementation.
