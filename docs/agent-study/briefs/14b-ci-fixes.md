# Brief 14b — CI fixes for PR #2

Branch `codex/agent-friendly-14`, worktree `qling-wt-14`. CI run 39027038264 failed all 3 jobs.
Local Windows `npm test` passes (1486, 0 fail); CI fails => tests depend on the developer machine.

## Failures (build-and-test = ubuntu, 7 tests; windows-unit = 6 tests)

| # | Test | File | Where | Error |
|---|---|---|---|---|
| 667 | project preflight extracts and reports missing Python build requirements | tests/unit/project-profile.test.mjs:94 | both | no `project:python:pytest` in testCommands |
| 669 | project preflight discovers pytest from a root test module without config files | project-profile.test.mjs:133 | both | same |
| 671 | project preflight maps a changed Python module to its nearest targeted test | project-profile.test.mjs | both | same family |
| 748/3 | mandatory rule files > loads real user home rules when present | tests/unit/rule-files.test.mjs:29 | both | "expected at least one rule file on this machine" (reads the real user home) |
| 1153 | explicit deliverables normalize aliases and absolute workspace paths | tests/unit/swebench-prediction.test.mjs:348 | ubuntu only | `C:/work/repo/zz_cli.py` not normalized to `zz_cli.py`, `C:/outside/nope.py` not rejected on Linux |
| 1303 | runWriteToolVerification uses the ProjectProfile targeted test after an indirect mutation | tests/unit/verification-loop.test.mjs:297 | both | status 'audit' !== 'pass' |
| 1310 | verify scope resolves a Python source file to its nearest test | tests/unit/ (verify scope) | both | Python targeted test not resolved |

Likely causes: Python/pytest detection probes the runner (python on PATH); tests reading the real home dir; tests/setup/isolate.mjs changing cwd/HOME/env; Windows-drive path handling on POSIX.

## Tasks

1. `.github/workflows/ci.yml` per-commit-typecheck: currently iterates `origin/<base>..HEAD` and fails on old commits lacking a `typecheck` script. Fix: use `git merge-base`; for each commit, if package.json has a `typecheck` script run it, otherwise fall back to `npx tsc --noEmit` (or skip with an echoed reason if there is no tsconfig) — pick the more robust option and justify it. Never hard-code commit hashes. Install or reuse deps per commit (reinstall only when package-lock.json changed).
2. Tests depending on runner tools (Python, pytest): choose the more robust of (a) mock/inject the environment probe, (b) explicit skip with a clear reason when the tool is missing, (c) install the tool in the workflow. Justify the choice in the RESULT.
3. Other environment-dependent tests (home rule files, paths): fix the test (fixture home, injection). Do not loosen assertions; do not weaken security. If a test exposes a real Linux/Windows code bug (suspect #1153: Windows-drive absolute paths on POSIX), fix the code and record it.
4. Check tests/setup/isolate.mjs interactions specifically.

## Rules
No commit, no push, no new dependencies, no reading .env, do not touch auth files, mocks/fake keys only, security only stricter, repo root stays clean.

## Acceptance
`npx tsc --noEmit` 0; `npm test` 0 fail; eval:recovery, eval:tasks, lint:invariants unchanged.
Write `docs/agent-study/results/14b-ci-fixes-RESULT.md`: per-failure root cause, change, choice rationale, whether it was a real code bug.
