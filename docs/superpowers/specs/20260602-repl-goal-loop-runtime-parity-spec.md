# REPL Goal Loop Runtime Parity Spec

## Problem

The classic `qingling repl` now routes slash commands through local scheduler and goal context, but it still falls short of the streaming TUI runtime semantics:

- `/goal <condition>` starts the first generated prompt, but does not run the goal evaluator after each model turn and therefore cannot auto-continue until the goal is reached.
- `/loop <interval> <prompt>` persists a local task, but the classic REPL does not start the scheduler poller, so due tasks do not run while the REPL is waiting for input.

This makes the classic REPL report local control features as enabled while only partially executing them.

## Goals

- Run goal after-turn evaluation in classic REPL whenever a local `SessionGoalController` is active.
- Continue generated goal prompts until the evaluator reports achieved, clears the goal, or the model path errors.
- Start the local session scheduler after lazy initialization so due `/loop` tasks run without requiring another user input.
- Stop the scheduler on REPL exit and session switches to avoid dangling timers.
- Keep all task and goal state in the existing local runtime directories.

## Non-Goals

- Changing streaming TUI behavior.
- Changing task or goal persistence formats.
- Adding daemon-backed behavior to classic REPL.
- Introducing a prompt queue to classic REPL.

## Acceptance Criteria

- `/goal <condition>` in classic REPL runs the initial generated prompt, evaluates the transcript, runs at least one continuation prompt when the evaluator returns `done=false`, and stops when the evaluator returns `done=true`.
- Classic REPL logs goal continuation and achieved/cleared status in a user-visible way.
- `/loop 1s <prompt>` in classic REPL starts a local session task that can run from the scheduler timer without another input line.
- Exiting the REPL stops local session controllers so scheduler timers do not keep the process alive.
- Targeted tests pass, followed by `npm run ci:check`.
