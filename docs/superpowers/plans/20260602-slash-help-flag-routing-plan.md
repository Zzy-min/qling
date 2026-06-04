# Slash Help Flag Routing Plan

## Implementation Steps

1. Add RED unit tests for slash command help flags:
   - `/exports --help`
   - `/导出列表 -h`
   - `/expors --help`
2. Update slash command routing to detect `--help` and `-h` before command execution.
3. For known commands, route to focused help using the canonical command name without the slash.
4. For unknown commands with a help flag, route to focused help using the typed command token without the slash.
5. Leave `/help` and `/?` command execution unchanged so existing focused help topic behavior remains stable.
6. Verify with the targeted slash command test file, then run `npm run ci:check`.

## Risk Controls

- Keep the change in `src/commands/index.ts` only.
- Do not mutate command definitions.
- Do not change unknown command behavior unless a help flag is explicitly present.
