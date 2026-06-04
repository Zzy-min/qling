# 未知 Slash 命令候选建议计划（2026-06-01）

## Step 1: RED 测试

- 扩展 `tests/unit/slash-commands.test.mjs`：
  - `/expors` 建议 `/exports`，并提示 `/help exports`。
  - `/导出列` 建议 `/导出列表`，并提示 `/help 导出列表`。
  - `/zzzzzz` 不输出误导性候选，只提示 `/help`。

## Step 2: 实现候选排序

- 在 `src/commands/index.ts` 中基于 `COMMANDS` 构造候选池。
- 使用确定性的本地评分：
  - exact/prefix/substring 优先。
  - Levenshtein 距离用于 typo。
  - 最多输出 3 个候选。
- 候选阈值保守，避免弱相关建议。

## Step 3: 更新未知命令提示

- 未知命令时输出：
  - 原未知命令。
  - 若有候选，输出 `你是不是想用: ...`。
  - 输出聚焦帮助提示 `/help <topic>`。
  - 否则保持 `/help` 通用提示。

## Step 4: 验证

- `npm run build`
- `node --test "tests/unit/slash-commands.test.mjs"`
- `npm run ci:check`
