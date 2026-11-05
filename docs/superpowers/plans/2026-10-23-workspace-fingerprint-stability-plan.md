# Plan: 根治工作区指纹误判导致的验证作废循环

## 实施步骤
1. **修改 `src/runtime/project-profile.ts`**：
   - 扩展 `FALLBACK_IGNORED_DIRS` 并实现 `shouldIgnoreIdentityPath(relativePath)`。
   - 在 `resolveProjectProfileIdentity` 中对 Git porcelain 输出和 Fallback 文件列表统一应用 `shouldIgnoreIdentityPath`。
   - 当 `root === path.resolve(os.homedir())` 且非 Git 仓库时，限制 `listFallbackWorkspaceFiles` 仅读取顶层常规文件。
2. **修改 `src/execution/verification-loop.ts` 与 `src/agent/main-loop.ts`**：
   - 在 `runWriteToolVerification` 中增加对 `changedPaths` 自身在验证前后是否被篡改的哈希比对：当 `verification.ok === true` 且已发生过一次 `workspace_changed_during_verification` 重试、同时 `changedPaths` 本身未被验证命令篡改时，直接放行 `pass`。
3. **新增与运行测试（`tests/unit/project-profile.test.mjs`、`tests/unit/verification-loop.test.mjs`、`tests/unit/verify-tool.test.mjs`）**：
   - 新增测试验证 Git 与非 Git 工作区均自动忽略 `.pytest_cache`、`__pycache__`、`*.pyc`、`*.tsbuildinfo`、`.gemini`、`.codex` 等副产物与后台目录。
   - 执行 `npm run build` 重新编译 `dist/`，并运行单元测试套件确认 100% 通过。
