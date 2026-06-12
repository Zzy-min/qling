# Spec: MiMo-inspired explicit slash goal subcommands

MiMo-Code presents `/goal` as a stop-condition primitive for long-running work. Qling already has session goals, but slash usage is ambiguous: `/goal status` is currently treated as setting the goal condition to `status`, while the CLI already exposes `qling goal status` and `qling goal set`.

## Requirements

- `/goal status` must show the current session goal status and must not set a new goal.
- `/goal set <condition>` must set the current session goal exactly like the existing `/goal <condition>` compatibility path.
- Chinese aliases `/目标 状态` and `/目标 设置 <condition>` must work the same way.
- Existing compatibility remains: `/goal` shows status, `/goal <condition>` sets a goal, `/goal clear` clears a goal, and `/goal daemon ...` keeps existing daemon behavior.
- Focused help must document explicit `status` and `set` usage.

## Non-goals

- Do not change goal persistence format.
- Do not introduce a second judge model or alter autonomous stop evaluation.
- Do not change top-level CLI goal behavior.

## Verification

- Slash command tests cover explicit English and Chinese subcommands.
- Focused help tests cover the updated slash usage.
- Full `npm run ci:check` passes before push.
