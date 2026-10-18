# Brief 14c — layering and PR commit range RESULT

Branch `codex/agent-friendly-14`, worktree `qling-wt-14`, starting HEAD `fe8a23f`. No commit, no push. No new dependencies. Layer rules in `scripts/dep-layers.mjs` were not edited and no allow-list entry was added.

CI run 39093483613: windows-unit was already green. Two failures were in scope: `ci:check` (`dep-layers --strict`) and `per-commit-typecheck`.

## 1. Layering

`context-compactor.ts` is core-services (rank 1). `context-history-repair.ts` lived at `src/` and matched no `layerOf` rule, so it was `other` (rank 3). The strict scan reported one forbidden edge: core-services imports other.

**What moved.** The whole `repairHistory` module (same function, same report shape, same synthetic tool text) now lives in `src/pipeline/context-history-repair.ts`. `pipeline/` is already classified as core-services, so the compactor's import is same-layer and is not an edge. `main-loop.ts` (agent-runtime) imports that path too; agent-runtime → core-services is allowed. Tests import `dist/pipeline/context-history-repair.js`.

**Why not a rule edit.** Adding the old filename to the core-services list would have made the scan pass without moving the dependency. That is the exception the brief forbids. Putting the module in `utils/` would also have been legal (foundation), but the function is the pre-send tool-protocol repair used by compaction, not a generic foundation util. `pipeline/` is the existing core-services directory that already owns that kind of step.

**Re-export.** `src/context-history-repair.ts` remains as a downward re-export only:

`other` → `pipeline/context-history-repair.ts` (core-services). Rank 3 → rank 1 is allowed. `context-compactor.ts` does not import the shim, so the reverse edge is not reintroduced. After `tsc`, `dist/context-history-repair.js` and `dist/pipeline/context-history-repair.js` are the same `repairHistory` function. An orphan tool input still reports `strippedToolResultIds: ["x"]` through both paths.

**Behaviour.** Call sites still run `repairHistory` on the same arrays (`compactDetailed` after the recent-window assembly, and `main-loop` before the provider send). No change to the repair rules.

`node scripts/dep-layers.mjs --strict`: `forbidden reverse edges: 0` (exit 0). `layerOf("pipeline/context-history-repair.ts")` is `core-services`. `layerOf("context-history-repair.ts")` is `other`.

## 2. per-commit-typecheck range

The job no longer runs `merge-base(origin/<base>, HEAD)..HEAD`. That walk is what pulled in the 33 commits back to the branch point, including history that does not typecheck alone.

**Chosen range** (no hashes in the workflow):

| Event | Range |
|---|---|
| `pull_request` `synchronize`, and `github.event.before` is a 40-hex SHA, not all-zero, present in the clone (fetched if missing), and an ancestor of `pull_request.head.sha` | `before..head.sha` — commits added by this push |
| otherwise (`opened`, `reopened`, missing/zero `before`, `before` not an ancestor) | `pull_request.base.sha..head.sha` |

Checkout stays `fetch-depth: 0` on `pull_request.head.sha`. The step also fetches a SHA only when `git cat-file` does not already have it. Base and head must both be 40-hex SHAs or the step exits 1. That rejects a non-SHA event field before it reaches `git`.

`git merge-base --is-ancestor` is only the ancestor predicate from the brief. It is not the left side of `rev-list`. The commit list is never "everything since the branch point."

An empty range checks `head.sha` once. Per commit, dependency install is unchanged: reinstall only when `package-lock.json`'s blob hash changes (`npm ci`, or `npm install` if there is no lockfile). A `typecheck` script wins; otherwise `npx tsc --noEmit` when `tsconfig.json` exists; otherwise the step prints a skip reason.

**Local check of the selector only** (no `git checkout`, so the worktree was not moved). Against this clone, `origin/main` merge-base to HEAD is the branch point, and `base.sha..head.sha` is 33 commits — the same width the brief describes. The selector then did:

- `synchronize` with `before` = HEAD's parent → 1 commit (the tip)
- `synchronize` with `before` = HEAD → empty range, head only
- `synchronize` with the all-zero SHA → PR range, 33 commits
- `opened` / `reopened`, even if `before` is a real parent → PR range, 33 commits (push range is not used)
- `synchronize` with a commit that is not an ancestor of HEAD → PR range, 33 commits

**Limits.**

- `base.sha..head.sha` is still the whole unmerged branch. On `opened` / `reopened`, and on the synchronize fallback, this PR still has those 33 commits, including old history that fails `tsc` on its own. The job will still fail in those cases. That is the brief's fallback, not a merge-base walk.
- A normal follow-up push is `synchronize` with `before` equal to the previous tip. Only commits from that push are checked. A re-run of an older workflow event still uses that event's `before`, which can be wider than "the latest push."
- A force-push makes `before` not an ancestor, so the job falls back to the full PR range and can fail on old commits again.
- Uncommitted files are not a commit. This working tree is not in any range until it is committed and pushed. Not done here.

## Verification

- `npx tsc --noEmit`: exit 0, no diagnostics.
- `npm test`: 1487 tests, 1486 pass, 0 fail, 1 skip.
- `npm run eval:recovery`: `{"ok":true,"fixtures":15,...}`.
- `npm run eval:tasks`: pass 11, fail 0, skip 0.
- `npm run lint:invariants`: `invariants strict: ok`, total 35 (same five buckets as 14b; no increase).
- `npm run ci:check`: exit 1. Dashboard vitest 1/1 passed. Unit tests 1487, 1486 pass, 0 fail, 1 skip. Smoke then failed one test and the `&&` chain stopped, so the later eval/packaging/layer steps did not run inside that process.
  - The only failure: `tests/smoke/cli-run-shutdown.smoke.test.mjs` — `cli run smoke: one-shot mode exits cleanly after response`. Error: `child process did not exit in time` at 10069ms. The test's own limit is 10s.
  - Isolated rerun of that file: 3 pass, 0 fail. The same test took 9302ms. Intermittent smoke timeout, not a layering or workflow failure. This change does not touch the CLI shutdown path.
- Steps that `ci:check` did not reach, run afterwards on the already-built `dist`: `eval-smoke` 22/0, `eval-tasks` 11/0, anchored-edit ok (improvement 50 ≥ 15), harness/context/memory/long-run/multi-agent passed, `validate-packaging OK`, `dep-layers --strict` forbidden 0, `lint:invariants` total 35 strict ok. Tail exit 0.

## Security

- No new trust boundary. History repair still only rewrites the in-memory message list the compactor and main loop already passed it.
- The workflow refuses base/head values that are not 40 hex characters before `git fetch` / `git rev-list`. `before` is used only after the same check, and a fetch of `before` cannot fail the job by itself (`|| true`); a missing or non-ancestor `before` falls back to the PR range.
- No `.env`, auth files, or dependency changes.

## Known-bad commit exception

SHA `7aaea91f385d5ee4ec34c8e7a271c130a7c62be7` only. It is pre-PR history. Typechecking that commit alone fails with TS2307 (cannot find `../runtime/project-profile.js` / `./managed-command.js`). It predates brief 14.

The `per-commit-typecheck` loop exact-matches that full SHA, skips it, and prints one line saying why. No other workflow logic changed.

This is acceptable because the user chose option A: `pull_request` `base.sha..head.sha` still contains the commit, and dropping it would rewrite history, which cannot be done without a force push.
