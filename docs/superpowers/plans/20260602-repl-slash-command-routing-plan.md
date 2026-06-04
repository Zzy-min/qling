# REPL Slash Command Routing Plan

## Implementation Steps

1. Add RED unit tests around a testable REPL single-line input handler.
2. Extract the current loop body into a reusable `handleInputLine(input)` method.
3. Keep existing exit and bang-command branches first.
4. Insert `handleSlashCommand(trimmedInput, this.agent)` before the model execution branch.
5. Keep the model path unchanged for ordinary prompts.
6. Verify with the targeted REPL/slash tests, then run `npm run ci:check`.

## Risk Controls

- Keep changes scoped to `src/repl.ts` and a focused unit test.
- Do not modify `StreamingREPL`, slash command implementations, or startup parsing.
- Use existing default slash command writers so behavior matches current TUI command output.
