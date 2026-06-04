# Classic REPL Startup Restore Local Status Feedback Spec

## Background

Classic REPL now hydrates local session controllers after startup `--resume` and `--continue`, and `/resume` plus legacy `!load` can report restored loop and goal status. Startup restore still prints only the restored session name and id, so users cannot immediately tell whether local loop tasks or a goal came back with the session.

## User Journey

As a Qingling user starting the REPL with `--resume` or `--continue`, I want the initial restore banner to show restored local loop and goal state, so that the CLI gives immediate confidence that local automation and goal tracking were restored.

## Requirements

1. Startup `--resume <session>` must print restored local active loop task count and goal status when local controllers are available.
2. Startup `--continue` must print the same restored local active loop task count and goal status when local controllers are available.
3. Startup restore must continue to checkpoint the restored session and hydrate local controllers before reporting local status.
4. Agents without local runtime methods must keep the existing startup restore output without requiring new methods.
5. Active loop task count must exclude canceled and completed tasks, matching `/resume`, `!load`, and streaming REPL behavior.

## Non-Goals

- Change startup argument parsing.
- Change session persistence format.
- Change whether startup hydration starts the scheduler timer.
- Change streaming REPL behavior.

## Acceptance Criteria

1. A classic REPL startup `resumeSession` unit test seeds one active future loop task and one active goal, then observes `Loop Tasks: 1` and `Goal: active` in startup restore output.
2. A classic REPL startup `continueSession` unit test seeds one active future loop task and one active goal, then observes `Loop Tasks: 1` and `Goal: active` in startup restore output.
3. Existing startup hydration tests continue to prove restored loop timers still resume.
4. `npm run ci:check` passes after implementation.
