# 顶层本地管理命令中文别名计划（2026-05-31）

## Step 1: 测试先行

- 扩展 `tests/unit/cli-startup.test.mjs`：
  - `诊断` -> `doctor`
  - `存储` -> `storage`
  - `导出列表 2` -> `exports` 且保留 `["2"]`
  - `会话列表 2` -> `sessions` 且保留 `["2"]`
  - `隐私` -> `privacy`
  - help 包含中文别名说明。
- 扩展 `tests/smoke/cli-startup.smoke.test.mjs`：
  - `node dist/index.js --file-state-dir <tmp> 隐私` 可直接退出。
  - 输出本地隐私边界，不包含 session 正文。

## Step 2: CLI parser 归一化

- 在 `src/cli/startup-contract.ts` 添加顶层 mode alias 表。
- 第一个非 option 参数识别时，先归一化中文别名，再进入现有 mode 判断。
- 保持 `subArgs`、warning、冲突检测逻辑不变。

## Step 3: Help 展示

- 在 `buildHelpText()` 的“兼容别名”附近加入中文别名说明。
- 不把中文别名作为新执行路径展示成独立命令族，避免重复文案。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/cli-startup.test.mjs" "tests/smoke/cli-startup.smoke.test.mjs"`
- `npm run ci:check`
