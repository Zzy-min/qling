# 13b provider-model-filter RESULT

- Pi session: qling-r4-13b, model magpie/codex-router/grok-4.7
- **Model errors: the log has 3 `"stopReason":"error"` entries ("The Grok gateway could not complete the upstream response stream.").** Per the rules: no retry, acceptance run before reporting. All acceptance checks passed.
- Snapshot: C:\Users\Lenovo\qling-agent-study\r4\pre13b (122 files)

## Changed files (relative to pre13b)
New
- tests/unit/provider-model-filter.test.mjs (6 tests)

Modified
- src/providers/presets.ts (+119): presetsForProvider, knownModelsForProvider, listProviderModelEntries, providerModelNames, formatProviderModelLines
- src/providers/remote-models.ts: defaults to the current provider. --all lists all presets, does not request other providers and does not read their keys. Remote failure or empty list falls back to this provider's presets. Unknown provider gets a hint. Output gains scope=provider|all.
- src/commands/claude-style.ts (+91/-52): the picker and /model list (including --remote) show only the current provider. Unknown provider gets a hint and fallback.
- src/help-topics.ts, src/commands/help.ts (was clean at pre13b; one help line changed), src/cli/startup-contract.ts (one help line), README.md (one paragraph)
- tests/unit/model-command.test.mjs (+199/-2)

## Mixed files
startup-contract.ts and README.md already held uncommitted changes. Brief 13b replaced only the one line each that brief 13 had written; the deleted lines are not in HEAD, so no user hunks were touched. The other modified files only had earlier brief changes layered on.

## Acceptance (before → after)
| Item | pre13b | after |
|---|---|---|
| tsc | 0 | 0 |
| npm test | 1505 / 1504 pass / 0 fail / 1 skip | 1515 / 1514 / 0 / 1 |
| eval:recovery | ok 15 | ok 15 |
| eval:tasks | 11/11 | passed |
| Root | clean | no new files |

Tests use mock fetch and fake keys only. No commit, no new dependencies.

## Unfinished / not verified
- The TUI picker was not checked by hand; only unit tests cover it.
- Because of the model errors, Pi may not have given its own summary on the last turn. The code is complete and passes acceptance.