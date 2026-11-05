# Spec: 根治工作区指纹误判导致的验证作废循环

## 1. 背景与问题
在 `qling` 运行过程中，当用户在非 Git 目录（尤其是用户主目录 `C:\Users\Lenovo`）或包含测试/编译副产物的 Git 仓库中执行任务时，常出现以下中止提示：
> `验证已连续两次因工作区指纹变化作废，自动重试已停止。已写入的文件仍保留。请直接查看交付文件；不要在这个失败循环里继续执行。`

经排查 `src/runtime/project-profile.ts`、`src/execution/verification-loop.ts` 与 `src/agent/main-loop.ts`，根因有三点：
1. **非 Git 目录（Fallback）扫描范围失控**：`listFallbackWorkspaceFiles` 仅忽略了 13 个固定目录名，未忽略 `AppData`、`OneDrive` 及 `.gemini`、`.codex`、`.claude`、`.agents`、`.dsh` 等隐藏运行时目录；且当 `workspaceDir` 为用户主目录（`os.homedir()`）时仍递归深入子目录扫描 10,000 个文件，极易被系统与宿主后台进程写入污染。
2. **Git 状态未过滤瞬态验证缓存**：`resolveProjectProfileIdentity` 在 Git 仓库中执行 `git status --porcelain=v1 -z --untracked-files=all` 时，未过滤 `.qling/`、`__pycache__/`、`.pytest_cache/`、`*.pyc`、`*.tsbuildinfo`、`coverage/` 等测试或类型检查器自身产生的瞬态副产物。
3. **目标文件未变动时的过度惩罚**：在 `runWriteToolVerification` 中，若验证命令本身已成功（`verification.ok === true`）且本次修改的目标文件（`changedPaths`）在验证前后哈希完全一致，或已重试过一次，不应因外部环境噪声将已成功的任务打入暂停失败态。

## 2. 设计方案
1. **统一身份路径过滤器 `shouldIgnoreIdentityPath(relativePath)`（`src/runtime/project-profile.ts`）**：
   - 忽略所有瞬态构建/测试缓存目录（`.qling`、`.git`、`node_modules`、`dist`、`build`、`.next`、`.nuxt`、`out`、`target`、`coverage`、`htmlcov`、`.nyc_output`、`__pycache__`、`.pytest_cache`、`.mypy_cache`、`.ruff_cache`、`.hypothesis`、`.tox`、`.nox`、`.turbo`、`.vite`、`.parcel-cache`、`.cache`、`.gradle`、`.venv`、`venv`）。
   - 忽略宿主与系统后台目录（`AppData`、`Application Data`、`Local Settings`、`OneDrive`、`Cookies`、`Recent`、`Temp`、`.gemini`、`.codex`、`.claude`、`.agents`、`.dsh`、`.pi`、`.opencli`、`.cc-switch`、`.antigravity`、`.antigravity-ide`、`.vscode`、`.idea`、`.cursor`、`.bun`、`.npm`、`.cargo`、`.rustup`、`.m2`、`.puro`）。
   - 忽略瞬态验证单文件（`.qling-verify.json`、`.coverage`、`*.pyc`、`*.pyo`、`*.tsbuildinfo`）。
   - 该过滤器同时作用于 Git porcelain 条目与非 Git `listFallbackWorkspaceFiles` 扫描。
2. **用户主目录（Home Workspace）降噪保护**：
   - 当 `workspaceDir` 为 `os.homedir()` 且非 Git 仓库时，`listFallbackWorkspaceFiles` 仅扫描顶层文件（不递归深入几十 GB 的子文件夹），避免后台应用写入污染工作区指纹。
3. **验证循环目标文件稳定性校验与收敛（`src/execution/verification-loop.ts` & `src/agent/main-loop.ts`）**：
   - 在 `runWriteToolVerification` 中，若 `verification.ok === true` 且本次修改的目标文件（`changedPaths`）在验证前后内容完全未变，เมื่อ工作区已有过一次 `workspace_changed_during_verification` 重试记录时，直接采纳验证通过结果，避免死循环；
   - 在 `main-loop.ts` 中，若触发二次指纹变化熔断但已写入文件完好，不再输出令人困惑的错误警告文案，而是平稳收敛。
