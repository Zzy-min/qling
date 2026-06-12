# Plan: MiMo-inspired explicit slash goal subcommands

1. Add RED slash tests for `/goal status`, `/goal set <condition>`, `/目标 状态`, and `/目标 设置 <condition>`.
2. Update `src/commands/goal.ts` to parse explicit status/set aliases before the compatibility free-form condition path.
3. Update focused help in `src/help-topics.ts` to advertise `/goal [status|set <condition>|clear|daemon ...]`.
4. Run targeted build + slash command tests, then full CI, old-name scan, diff check, and npm audit.
5. Commit and push to `origin/main`.

## Risk controls

- Keep daemon parsing before free-form conditions.
- Keep legacy `/goal <condition>` compatibility to avoid breaking existing muscle memory.
- Treat status aliases as read-only and assert they do not call `setGoal`.
