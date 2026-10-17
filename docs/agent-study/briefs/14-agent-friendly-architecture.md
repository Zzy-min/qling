# Brief 14: agent-friendly architecture (implementation, items 1–4)

Background analysis: `docs/agent-study/briefs/14-agent-friendly-architecture-analysis.md` (same directory). This brief covers only Tier 1 #2 and Tier 2 #1, #4, #5 from that analysis.

## Working location (hard rule)
- Work **only** in `C:\Users\Lenovo\projects\qling-wt-14` (branch `codex/agent-friendly-14`, based on ffdf824).
- `C:\Users\Lenovo\projects\qling` (the main checkout) is **read-only**. Never write to it, and never run git commands that change it (checkout/stash/reset/add/apply/commit).
- No commit, no push. Do not read `.env`. Do not touch auth files. Add no dependencies. Tests use mocks and fake keys only. Security may only get stricter.

## Item 1: port resolve-llm as the single key entry point
Port source (read-only reference): `C:\Users\Lenovo\qling-agent-study\r4\port14\brief12-13c.patch`.
- It holds the src/tests changes from briefs 12/13/13b/13c in the main checkout, as a diff against "the pre-brief-12 snapshot, or HEAD".
- The file list is in `files.txt` next to it.
- The patch may also include a few edits the user made by hand. **Port only what belongs to the briefs.** Use `docs/agent-study/results/12-*.md`, `13-*.md`, `13b-*.md`, `13c-*.md` in the main checkout (read them there) to tell the two apart.
  - If a hunk cannot be assigned to a brief, do not port it. List it in the RESULT as "not ported (suspected user change)".

Requirements:
- `src/providers/resolve-llm.ts` (`resolveProviderApiKey` / `resolveLlmSettings`) becomes the **only** place that resolves a provider key.
  - Every other key-fallback site calls it: index.ts, agent-loop.ts, tools/subtask.ts, tools/vision-analyze.ts, session/goal-evaluator.ts, eval/llm-tasks.ts.
  - Brief 13 already changed some of these; finish the rest.
- Default provider/model come only from `presets.ts`. Export `DEFAULT_PROVIDER` and `DEFAULT_MODEL`; DEFAULT_MODEL = the deepseek preset's model, i.e. `deepseek-flash` from 13c.
  - Replace the hard-coded `"deepseek-chat"`/`"deepseek-flash"` defaults in other files with these constants: config.ts, resolve-llm.ts, context-compactor.ts, pipeline/verification.ts, tui/streaming-tui.ts.
- Bring along what brief 12 (model-retry), 13b (provider-model-filter) and 13c (new presets plus RETIRED_MODELS) need. Also bring the tests from those briefs (model-retry*, provider-key-resolution, provider-model-filter, model-presets-refresh, plus the matching assertions in existing tests).
- Behavior must match the main checkout's briefs 12–13c. Do not change key rules or the retry policy.

## Item 2: npm run lint:invariants
- Formalize the prototype `/workspace/qling-ro/.agent-proto/check-invariants.mjs` (reproduced at the end of this brief) as `scripts/check-invariants.mjs`.
  - Use zero dependencies, Node only (fs walk plus regex). Do not depend on rg.
  - Rules: provider-key fallback outside resolve-llm; hard-coded default model outside presets; process.env writes outside config; numeric env defaults written inline; process.cwd() used in state paths.
- Baseline file `scripts/invariants-baseline.json`. Model it on the `--strict`/`--baseline`/`--write-baseline` mechanism in `scripts/dep-layers.mjs`.
  - A count above the baseline (per rule, by file:pattern) fails.
  - A count below the baseline passes with a hint to run write-baseline (the baseline may only shrink).
- package.json: add `lint:invariants` (strict) and `lint:invariants:write-baseline`.
- Add `node scripts/check-invariants.mjs --strict` to the end of `ci:check`.
- Generate the baseline after item 1 is done (item 1 should have removed some violations).
- Add `tests/unit/check-invariants.test.mjs`, using a temporary fixture directory, covering: a new violation fails, matching the baseline passes, and dropping below the baseline passes.

## Item 3: automatic test isolation
- Add a global setup, e.g. `tests/setup/isolate.mjs` loaded with `node --import`, wired into the `test` script and the unit-test segment of `ci:check`. It must:
  - Before each test file, chdir into a temporary directory.
  - Remove `*_API_KEY` and `QLING_*` from env. Allow-list any variable the test runner itself needs.
  - Record `git status --porcelain` of the repo root (pre-existing files do not count) and compare when the process exits. If new files appear in the root, exit with a non-zero code and print them.
- If a test depends on cwd being the repo root and breaks, fix the test with paths relative to `import.meta.url`. Do not weaken the guard.
- `.gitignore`: add `sessions/` and `nul`.
- Add a test proving the guard catches a stray file in the root and catches leaked env vars. A subprocess is acceptable.

## Item 4: typecheck / test:changed / per-commit CI compile check
- package.json:
  - `typecheck`: `tsc --noEmit`.
  - `test:changed`: a Node script, `scripts/test-changed.mjs`. It takes the changed files from `git diff --name-only HEAD` plus untracked files and maps src/x.ts to tests that reference that module name. Run `tsc` first, then only the matched tests. With no matches, run typecheck only.
- CI: find the existing GitHub workflow under `.github/workflows/` and add a job, or a new workflow file, triggered on pull_request:
  - checkout with fetch-depth 0, then npm ci;
  - `git rebase -x "npm run typecheck" origin/${{ github.base_ref }}`, or an equivalent loop that runs typecheck on each commit.
  - Use the same Node version as the existing workflow.

## Acceptance (run by the coordinator; you should run tsc, build and the relevant tests yourself)
- tsc passes.
- npm test has 0 failures.
- eval:recovery ok 15; eval:tasks passes.
- `npm run lint:invariants` and `npm run ci:check` pass.
- No new files in the worktree root.
- `git status` in the main checkout is unchanged.

## Final reply
- Files changed.
- Port list (each brief → files; what was not ported, and why).
- Status of each of the 4 items.
- Unfinished work.
- A suggested split into independently compiling small commits.

---
Prototype check-invariants.mjs:
```js
// Prototype (not committed): deterministic agent-pitfall checks.
import { execSync } from "node:child_process";
const rg = (p, extra="") => { try { return execSync(`rg -n ${extra} ${JSON.stringify(p)} src`, {encoding:"utf8"}).trim().split("\n").filter(Boolean); } catch { return []; } };
const rules = [
  ["provider-key-fallback outside resolve-llm", rg("(DEEPSEEK|OPENAI)_API_KEY", "-g '!**/resolve-llm.ts' -g '!**/i18n/**'")],
  ["hard-coded default model outside presets", rg("\"(deepseek-chat|deepseek-flash|gpt-4o)\"", "-g '!**/presets.ts'")],
  ["process.env write outside config", rg("process\\.env\\.[A-Z_]+ =[^=]", "-g '!config.ts'")],
  ["numeric env default inline (Number(process.env.X ?? n))", rg("Number\\(process\\.env\\.[A-Z_]+\\)? *(\\?\\?|\\|\\|) *\\d")],
  ["process.cwd() in runtime state paths", rg("process\\.cwd\\(\\).*(session|state)", "-i")],
];
let total = 0;
for (const [name, hits] of rules) { total += hits.length; console.log(`${hits.length.toString().padStart(4)}  ${name}`); hits.slice(0,4).forEach(h=>console.log("      "+h.slice(0,140))); }
console.log("total", total);
```
