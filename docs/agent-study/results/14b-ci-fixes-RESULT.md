# Brief 14b — CI fixes RESULT

Branch `codex/agent-friendly-14`, worktree `qling-wt-14`. No commit, no push. No new dependencies.

CI run 39027038264 failed all 3 jobs. Local Windows `npm test` passed because the developer machine has Python+pytest and a home `AGENTS.md` / user-rules file. The runners do not.

## Per-failure

### per-commit-typecheck (job 3, not in the unit-test logs)

- **Cause:** The job walked `origin/<base>..HEAD` and ran `npm run typecheck` on every commit. `typecheck` was added in `4aff601`. Earlier PR commits have `tsconfig.json` and `typescript` but no such script, so `npm run typecheck` exits non-zero. `origin/main..HEAD` is also the wrong range once `main` moves past the branch point.
- **Change:** `.github/workflows/ci.yml` now uses `git merge-base "$base" HEAD` and `rev-list` of that commit..HEAD. No commit hashes. For each commit, reinstall only when `package-lock.json`'s blob hash changes (`npm ci`, or `npm install` if there is no lockfile). If `package.json` has a `typecheck` script, run it. Otherwise, if `tsconfig.json` exists, `npx tsc --noEmit`. If neither exists, echo a skip reason and continue.
- **Why `tsc --noEmit` instead of skip:** The job exists to prove each commit typechecks. These old commits still have a tsconfig; skipping would hide real type errors. Skip is only honest when there is nothing to typecheck.
- **Real product bug?** No. Workflow invocation gap.

### 667 / 669 / 671 — project preflight pytest (`tests/unit/project-profile.test.mjs`)

- **Cause:** `inspectProjectProfile` shells out to `python`/`python3` and `importlib` to decide whether `project:python:pytest` is registered. Ubuntu has Python but not the `pytest` module, so the command is omitted (667, 669) and scoped resolution returns `undefined` (671, expected `astropy/io/ascii/tests/test_qdp.py`). The same three failed on Windows CI. Test 668 passed only because the missing bootstrap module is genuinely absent whenever any Python exists; it would fail on a runner with no Python at all.
- **Change:** Optional `ProjectEnvironmentProbe` on `inspectProjectProfile` / `inspectProjectProfileCached`. Tests pass `hostIndependentPythonProbe()` (`tests/helpers/python-probe.mjs`): `python` exists, `pytest` is importable, named missing distributions/modules are not. Production callers pass nothing and still probe the host. A probe is not cached.
- **Why inject, not skip, not `pip install pytest`:** Skip would drop the scoped-verifier contract on CI. Installing pytest still depends on the image (`python` vs `python3` changes the command string the test matches) and on a package *not* being installed for the missing-build-requirement case. Injection makes both "pytest present" and "distribution missing" deterministic, with no new dependency.
- **Real product bug?** No. The host probe is the right production behavior. The tests were integration tests wearing unit-test clothes.

### 748 — `loads real user home rules when present` (`tests/unit/rule-files.test.mjs`)

- **Cause:** The test called `loadMandatoryRuleFiles` with `USERPROFILE || HOME` and did not pass `homeDir`, so candidates fell through to `os.homedir()`. This machine has `AGENTS.md` / `.qling` rules. GitHub runners do not. `tests/setup/isolate.mjs` chdirs and scrubs `QLING_*` / `*_API_KEY` only. It does **not** remap `HOME`/`USERPROFILE`: Node caches `os.homedir()` at startup and several modules capture it at import, so rewriting those variables would not isolate home reads and could desync modules that already captured it.
- **Change:** The test builds a temp home with `user-rules.md` and `AGENTS.md` and passes `homeDir` + `stateDir`. Assertions are stricter (both fixture bodies must appear). Isolate documents why home is not virtualized.
- **Real product bug?** The home-directory dependency was a test bug. The Linux rerun of that fixture then exposed a real loader bug, below.

### Follow-up — case-variant rule files (`loadMandatoryRuleFiles`)

- **Cause:** Real code bug. Dedupe used `path.resolve(p).toLowerCase()` *before* the file was known to exist. Candidate order is `Agents.md` then `AGENTS.md` (same for `Claude.md` / `CLAUDE.md` and the workspace pair). On a case-sensitive filesystem the missing `Agents.md` still occupied the key `.../agents.md`, so the real `AGENTS.md` was never read. Linux fixture then saw only `user-rules.md` (`files.length < 2`). Windows and typical macOS hide this because both names are one file.
- **Change:** A missing path is not recorded. Files that exist are deduped by `realpath` (one physical file on Windows/macOS) and by exact content (different paths, same text, keep the first). `fileSystem` is an optional in-process test seam, not an environment variable. The new unit test uses a case-sensitive map, so it fails on every OS if a missing `Agents.md` suppresses `AGENTS.md`, if two realpaths of one file load twice, or if identical content loads twice.
- **Real product bug?** Yes. The old key dropped mandatory rules on Linux. Loading the previously skipped file is stricter.

### 1153 — explicit deliverables (`tests/unit/swebench-prediction.test.mjs`), Ubuntu only

- **Cause:** Real code bug. `resolveExplicitDeliverablePaths` used `path.isAbsolute` / `path.resolve`. On POSIX, `C:\work\repo\zz_cli.py` is not absolute, so it was kept as a relative path, and `C:\outside\nope.py` was not rejected. Isolate's temp cwd made `path.resolve("C:\\work\\repo")` land under that temp dir, but the root mistake is treating a drive path as relative.
- **Change:** On a non-Windows platform, drive-letter and UNC inputs are resolved with `path.win32` against a Windows workspace. Outside paths (`../`) are dropped. A POSIX workspace still rejects drive-letter inputs. The test now also calls the function with platform `"linux"`, so the bug is caught on Windows too. Host-cache aliases (`file_cache_dir/`, `file_state_dir/`) are rejected for a synthetic Windows workspace (they are not inside that workspace).
- **Real product bug?** Yes. Containment is stricter, not weaker: `C:/outside/nope.py` is dropped on Linux instead of being accepted.

### 1303 — `runWriteToolVerification` targeted pytest (`tests/unit/verification-loop.test.mjs`)

- **Cause:** Same missing `project:python:pytest` registration. With a degraded profile and no runnable command, the loop returns `audit` instead of `pass`. The test's `runCommand` mock is not the path under test: a registered pytest command uses `runManagedCommand` argv execution.
- **Change:** The test injects a probe whose `pythonInvocation` is an absolute `node` plus a stub that exits 0 for `-m pytest`. Displayed command stays `python -m pytest`. Non-absolute invocation executables are ignored. The assertion `commands.length === 0` still requires argv execution rather than the shell mock.
- **Real product bug?** No. Same host-pytest coupling as 667.

### Follow-up 2 — `runLsp refreshes symbols after a file changes` (`tests/unit/lsp.test.mjs:139`)

- **Cause:** Real code bug, seen on a clean Linux Node 22 repro (ext4/overlay), not in CI run 39027038264. About 2 of 4 runs: after rewriting `demo.ts` with same-length text, `document_symbols` still returned `oldName`. `getScriptVersion` was `${mtimeMs}` for the single-file service and `${mtimeMs}:${size}` when a tsconfig exists. TypeScript keeps the snapshot while that string is unchanged, so two writes in one timestamp tick with equal size were invisible.
- **Change:** Both language-service hosts now version a file as `mtimeMs:size:sha256(contents)`. An equal stamp with different bytes produces a new version, and the service re-reads the snapshot. `resetTsServiceCache` drops the observed-script map. The existing test still requires `newName` and no `oldName`. It now also pins both writes to the same `utimes` timestamp and asserts the byte length and `mtimeMs` did not change, so the stale path is hit on every OS instead of only when the filesystem clock does not tick.
- **Real product bug?** Yes. A changed file could keep stale symbols, hover, and definition until mtime or size moved.

### 1310 — verify scope (`tests/unit/verify-tool.test.mjs`)

- **Cause:** `runVerify` rebuilds the profile from the host. Without pytest, `project:python:pytest` is unregistered, so `is_error` is true (`expected false`).
- **Change:** `runVerify(args, options?)` accepts a probe only as a second argument. It is not on the tool schema and is not read from `args`, so a model tool call cannot fake the environment. The test passes the same absolute stub. Scope assertion is unchanged: `pkg/module.py` → `pkg/tests/test_module.py`.
- **Real product bug?** No.

## Verification

- `npx tsc --noEmit`: exit 0, no diagnostics (after the script-version fix).
- `tests/unit/lsp.test.mjs`: 7 pass, 0 fail, including two repeats of the pinned-mtime refresh test.
- Full unit suite after the fix: 1487 tests, 1485 pass, 1 fail, 1 skip. The failure is `repl slash loop runs due task from local scheduler timer` (`EPERM` renaming a temp session-tasks file on Windows). It does not touch LSP or script versions. Rerun of that test alone: pass.
- `npm run lint:invariants`: `invariants strict: ok`, total 35 (baseline allows no increase).
- `npm run eval:recovery`: `{"ok":true,"fixtures":15,...}`.
- `npm run eval:tasks`: pass 11, fail 0, skip 0.

## Security

- Probe and `pythonInvocation` are caller arguments, not environment variables and not model tool fields.
- A non-absolute `pythonInvocation.executable` is ignored.
- Deliverable normalization rejects Windows paths outside the workspace on POSIX; it does not accept new escapes.
- Rule-file dedupe no longer drops a differently cased file that exists. The same physical file and the same content are still loaded once. The test filesystem override is a function argument, not config or model input.
- LSP script versions change when file bytes change, even if mtime and size do not. The service still only reads files it was already going to snapshot.

## Commits

On top of 390555e. Each was checked with `npx tsc --noEmit` (exit 0). On 3b33161: npm test 1487 tests, 1486 pass, 0 fail, 1 skip; eval:recovery ok; eval:tasks pass; lint:invariants strict ok. Linux (Node 22, no pytest): npm test 3 runs, 0 fail.

- 9091594 ci: base per-commit typecheck on merge-base and fall back to tsc
- c5c860b fix(deliverables): contain Windows drive paths when running on POSIX
- ffb177 fix(rules): stop missing case variants from hiding existing rule files
- e0c3144 fix(lsp): include content hash in script versions
- 997880d test: inject a host-independent Python probe into project profile tests
- 3b33161 docs(agent-study): add brief 14b and CI fixes RESULT
- this commit: docs(agent-study): record brief 14b commit list
