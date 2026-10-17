# 14 Making qling agent-friendly: inverse-pyramid analysis (read-only)

Date: 2026-10-17 (UTC+8). Sources: box clone `/workspace/qling-ro` @ `ffdf824` (190 commits, 51 `fix` commits, 0 reverts); PC briefs 01–13c and RESULTs 01–13c (`C:\Users\Lenovo\projects\qling\docs\agent-study\results\`); brief 13. Nothing was modified or committed. Prototype check (untracked): `/workspace/qling-ro/.agent-proto/check-invariants.mjs`.

Method (poteto's "inverse pyramid"): fix things in the code first (types, shared modules, making the easy path the right path). Next, static analysis (lint, tests, CI). Then minimal prose (AGENTS.md). Last, human review, saved for what cannot be automated.

Note: the box clone sits at HEAD `ffdf824` and has none of brief 12/13 work. All `file:line` references below point to that HEAD. Brief 13 on the PC already fixed part of cluster 1, but those changes are uncommitted.

## Pitfall clusters (ranked by frequency × cost)

| # | Cluster | Evidence count | Key evidence |
|---|---|---|---|
| 1 | **Config / env resolution scattered** (key reuse across providers, duplicated fallbacks, defaults drift, wrong env names) | 15 provider-key fallback sites, 11 hard-coded default-model literals, 19 `process.env` writes outside config, 13 inline numeric env defaults, 284 `process.env.QLING_*` reads in 84 files; the issue appears in 5 RESULTs (01, 12, 13, 13b, 13c) | Brief 13 §10: the same key-fallback chain is copied in 6 places (`index.ts:1089-1093`, `agent-loop.ts:349-366`, `tools/subtask.ts:122-138`, `tools/vision-analyze.ts:84-86`, `session/goal-evaluator.ts:53-61`, `eval/llm-tasks.ts`). RESULT 13c had to change the default `deepseek-chat` in **6 files** (`config.ts`, `resolve-llm.ts`, `context-compactor.ts:180`, `pipeline/verification.ts:37`, `tui/streaming-tui.ts:270`). RESULT 12: the retry default is 3 in `config.ts:270`/`:534`/`agent-loop.ts:415` but 5 in `model-retry.ts`, so the CLI and SDK disagree. RESULT 01: the agent changed the compaction default 500→200 and it was reverted; the default lives in 3 places (`config.ts`, `agent-loop.ts:1226` `|| 500`, `context-compactor.ts:191` `?? 500`), and `QLING_COMPACTION_BREAKER` is read directly from env, bypassing config. The `agent-loop.ts:128` message lists only 3 key env vars while there are 8 providers. |
| 2 | **Scope creep into out-of-brief / user-dirty files** | Out-of-scope files in 8 of 13 RESULTs (01, 02, 05: 4 files, 06, 07: 3 files, 08: 3 files, 12, 13); user-dirty files touched in 7 RESULTs (04, 05, 06: 7 files, 07, 08: 6 files, 09, 11, 13: 6 files) | The hotspots are always the same god-files: `agent-loop.ts` (2018 lines, 45 commits), `index.ts` (1451 lines, 32), `config.ts` (1126 lines, 19), `agent/main-loop.ts` (1079 lines, 15), `types.ts` (15). Every new feature has to edit them because wiring is centralized. |
| 3 | **Unsafe defaults / security relaxations introduced silently** | 6 cases caught only by human or coordinator review | 02c: complex shell syntax downgraded deny→ask for 4 commands (`bash -c 'rm -rf /'`). 02: a missing `decision` was handled differently on 3 paths (config/PermissionMatrix/permissions-report). 04: an MCP tool with no annotations defaulted to `readOnly=true`. 05: sub-agent leaked parent MCP tools and SessionStart. 08: brief said "disable entry on bad matcher", which fails open for PreToolUse. 11: whole-name matcher dropped `Edit`→MultiEdit coverage. |
| 4 | **Side effects leaking into the repo/host** (cwd writes, temp files, env) | 4 incidents + 82 `process.cwd()` uses in src | 06: `sessions/session-*.json` written to repo root by tests because `fileStateDir=process.cwd()` and relative stateDir resolved against cwd. 09: agent shell made a `nul` file. `4564913`: tests leaked host `QLING_LLM_API_KEY`. 11b: snapshots in %TEMP% got wiped. `.gitignore` has no `sessions/` entry. |
| 5 | **Large unbuildable / unverified change sets** | 25 of 190 commits touch >20 files (`f274ed4`: 44 files, +3371; `a642c06`: +1781). Mid-run build breaks in 09 (TS2345), 12 (TS2366), and 13 (failing test). 9 of 13 runs ended on a gateway or model error before the agent's own summary. | The coordinator had to rebuild verification from scratch each time. `npm test` runs `build` first, so it is slow and coarse. There is no `typecheck`-only script and no ESLint. One env-dependent test (`verify tail`, npm 12 banner) stayed red as the "baseline" for 10 rounds until 11 fixed it. The Windows EPERM flake is still open. |

Smaller recurring items:
- Duplicated algorithms: RESULT 03 added a second private MMR/Jaccard next to `memory-card-index.ts:238`.
- Two `MCPServerConfig` types (RESULT 04).
- Optional wiring nobody connected: in 11b, `knownToolNames` was never passed in production.
- Help text, aliases and the README drift: the same 3 files (`help-topics.ts`, `commands/help.ts`, `startup-contract.ts`) were touched in 07, 08, 13, 13b.

## Proposed changes (ranked by value/effort)

### Tier 1: code (make the right path the easy path)
1. **One typed settings module, env read once** (high value, medium effort; fixes cluster 1 and part of 2).
   - Add `src/settings/` holding a `SETTINGS` registry: `{ key, env: "QLING_X", type, default, min/max, doc }`, one entry per knob.
   - Add `getSetting(key)`, typed by key. Callers stop parsing `process.env`, so a default cannot be written twice.
   - Generate the env-var docs and the `/config` source column from the registry. A message cannot name an env var that is not in the registry (`SettingKey` union).
   - Stop `applyConfigToProcessEnv` from writing back to `process.env` (`config.ts:529-556`). Instead, pass a frozen `ResolvedConfig` down.
2. **Finish the provider boundary** (high value, low effort; brief 13's `resolve-llm.ts` is already 80% there). Commit it, then:
   - make `resolveProviderApiKey(provider)` the only way to get a key;
   - make `DEFAULT_MODEL`/`DEFAULT_PROVIDER` come only from `presets.ts`;
   - use branded types `ProviderId` and `ApiKey<P>` so a key for provider A cannot type-check where provider B is expected.
3. **A single `StateDir` type** (medium value, low effort; fixes cluster 4).
   - `type AbsStateDir = string & {__abs: true}`, built only by `toStateDir()`, which throws on relative or empty paths.
   - Checkpoint, session and spill writers accept only `AbsStateDir`. `canWriteMidTurnCheckpoint` (from 06) becomes a type instead of a runtime check.
4. **Fail-closed policy combinators** (high value, low effort; fixes cluster 3).
   - One `Decision = "allow"|"ask"|"deny"` with `strictest(...ds)` and `atLeast(d, floor)`.
   - Use them in hooks, permissions, Plan Mode and MCP. Missing data maps to `deny`/`ask` by construction: `normalizeDecision(undefined) → "deny"`, and a `readOnly` that defaults to false.
5. **Break up the god-files with registration seams** (high value, high effort; fixes cluster 2).
   - Move wiring in `agent-loop.ts`, `index.ts` and `config.ts` to feature modules that register through `registerFeature({ settings, hooks, commands, help })`. A new feature then adds a file instead of editing 5 shared ones.
   - Start with the CLI modes and help: drive `startup-contract`, `help-topics` and `commands/help` from one command table.
6. Dedupe: one `mmrRerank` in `src/memory/mmr.ts`, one `MCPServerConfig`.

### Tier 2: static analysis / tests / CI
Prototype results today (`.agent-proto/check-invariants.mjs`): 59 violations.
- 15 provider-key fallbacks.
- 11 default-model literals.
- 19 env writes outside config.
- 13 inline numeric env defaults.
- 1 cwd state path.

Changes:
1. **Turn that script into `npm run lint:invariants` in `ci:check`**, with a baseline file that may only shrink. The same mechanism as the existing `dep-layers --strict`. Effort: about 1h.
2. Add ESLint `no-restricted-syntax`/`no-restricted-properties`:
   - ban `process.env` outside `src/settings/**`;
   - ban `process.cwd()` outside `cli/**`;
   - ban string literals that match preset model ids outside `presets.ts`.
3. **Policy property tests:** for every `Decision` merge path, the new result must be no more permissive than the old one. Generalize the 02c test `hooks-danger-regression` into a table-driven "no-relaxation" suite over hooks, permissions, Plan Mode and MCP readOnly.
4. **Test hygiene guard:** a global `node --test` setup that runs `chdir` into a tmp dir, scrubs `*_API_KEY`/`QLING_*` from env, and fails a test that leaves new files in the repo root (`git status --porcelain` before/after). Add `sessions/` and `nul` to `.gitignore`.
5. Add `typecheck` (`tsc --noEmit`) and `test:changed` scripts so agents get feedback in seconds. Add a CI job that builds every commit in the PR (`git rebase -x "npm run typecheck"`). This catches "doesn't compile until split".
6. **Settings drift test:** every `SETTINGS` key has a doc line and appears in `/config`. The CLI default must equal the SDK default (the retry 3-vs-5 bug in RESULT 12).
7. Quarantine flakes: tag `repl slash loop…` (Windows EPERM) and track it, so "baseline failure" is never accepted as normal.

### Tier 3: minimal prose (AGENTS.md, about 30 lines, no essay)
- Commands: `npm run typecheck`, `npm run test:changed`, `npm run lint:invariants`, and run `ci:check` before finishing.
- Hard rules, each linked to the check that enforces it:
  - settings only through `getSetting`;
  - provider keys only through `resolve-llm`;
  - never relax a `Decision`;
  - state writes take `AbsStateDir`.
- "Touch only the files the brief lists. If you need another file, stop and report." Add a list of user-dirty files to avoid, generated per run with `git status`.
- Don't change defaults unless the brief says so. A default lives in `SETTINGS` only.
- Optional skill `qling-feature`: a scaffold for registerFeature, test and help entry.

### Tier 4: human review focus (what checks can't decide)
- Any `Decision`/trust/permission change: does it change semantics for existing user configs? (11 matcher narrowing, 08 trust gate default.)
- Default values and user-visible behavior changes (01 compaction, 12 retries, 13c model presets).
- New cross-module wiring or new files outside the brief (05 `subagent-scope.ts`).
- Mixed hunks in user-dirty files. Better still, give agents a separate worktree so this cannot happen (see open questions).

## Suggested rollout
1. Week 1: commit `resolve-llm` (brief 13), add `lint:invariants` with a baseline, add `typecheck`, add the test hygiene guard and `.gitignore`. All cheap, and they stop clusters 1, 4 and 5 from getting worse.
2. Week 2: the `SETTINGS` registry, migrating the 13 inline defaults and 19 env writes; `Decision` combinators plus the no-relaxation suite.
3. Later: registration seams to shrink `agent-loop.ts`/`index.ts`/`config.ts`.

## Open questions
1. Should agent runs use a separate `git worktree` off HEAD instead of the PC checkout with about 81 uncommitted files? That removes most of cluster 2's mixed-file risk.
2. How should the 81 uncommitted files plus briefs 07–13c work be committed? Small, buildable commits per brief?
3. Is the `process.env` write-back (config → env → components) relied on by external hooks or plugins? That decides whether the registry can remove it.
4. Should ESLint be added as a dependency, or do the bans stay in a zero-dependency rg/AST script like `dep-layers.mjs`?
5. What is the canonical retry default (3 or 5)? The MiniMax endpoint (`api.minimaxi.com` vs `api.minimax.cn`)?
6. The specific "wrong env var name in a message" incident wasn't located in the RESULTs. The closest is `agent-loop.ts:128`, which lists only 3 of 8 provider key vars. Please confirm.
