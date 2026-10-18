# Brief 14c — layering violation and PR-only per-commit typecheck

Worktree `qling-wt-14`, branch `codex/agent-friendly-14` (HEAD fe8a23f). CI run 39093483613: windows-unit green; two failures remain.

## 1. Layering violation (build-and-test, `npm run ci:check`)
The architecture check reports `forbidden reverse edges: 1 — core-services -> other: context-compactor.ts imports context-history-repair.ts`.
- Really remove the reverse edge. No allow-list or exception entry, and do not edit the layer rules to make it pass.
- Options: move the part that is used (or the whole module) into an allowed layer (core-services or foundation), or invert the dependency (e.g. inject the repair function from the caller). Keep `src/agent/main-loop.ts` and other importers working; keep a re-export only if it does not reintroduce the edge.
- Behaviour must not change. All existing tests keep passing; update import paths in tests if a module moves.

## 2. per-commit-typecheck: only this PR's new commits
Current job walks `merge-base(origin/main, HEAD)..HEAD`. main is far behind (1bcc080), so the range has 33 commits, including old pre-PR history such as 7aaea91 that does not compile on its own (TS2307).
- Do not hard-code any hash. Do not walk back old history from merge-base.
- Required: use the PR event data. Note: `github.event.pull_request.base.sha..head.sha` and the GitHub PR commit list BOTH still contain all 33 commits here, because the branch was never merged to main. Pick a range that really limits the check to new commits, and explain the choice in the RESULT. A reasonable design: on `synchronize`, check `github.event.before..github.event.pull_request.head.sha` (the commits added by this push), falling back to the PR range only when `before` is missing, all-zero, or not an ancestor; on `opened`/`reopened`, use the PR range (base.sha..head.sha). Make sure the checkout has enough history (`fetch-depth: 0` or explicit fetch).
- Keep the fallback: a commit without a `typecheck` script runs `npx tsc --noEmit`; skip with a printed reason only when there is no tsconfig. Keep the per-commit dependency install/reuse logic.

## Rules
No commit, no push, no new dependencies, no reading .env, do not touch auth files, mocks/fake keys only, security only stricter, repo root stays clean. Do not touch the main checkout.

## Acceptance
`npx tsc --noEmit` 0; `npm test` 0 fail; eval:recovery, eval:tasks, lint:invariants unchanged; `npm run ci:check` passes (if only a smoke test times out intermittently, say so explicitly).
Write `docs/agent-study/results/14c-layering-and-pr-commits-RESULT.md`: what moved and why, the chosen commit range and its limits, verification output.
