# 轻灵 TUI 多行输入与 Markdown 渲染收尾记录

## Scope

本轮收尾聚焦 `20260615-tui-multiline-markdown` 计划：

- 多行与长文本输入在现有非全屏 TUI 中保持可编辑草稿，不拆成多次任务提交。
- 输入框最多显示 5 行可视窗口，使用 `▲` / `▼` 指示还有隐藏内容。
- `appendFinal()` 接入纯终端 Markdown 渲染器，支持标题、列表、代码块和 Markdown 表格。
- 表格使用 `string-width` 计算列宽，避免中文宽字符导致边框错位。
- 普通长段落和长列表按终端宽度软换行，减少横向溢出。

## Review Notes

- 已确认旧的 `docs/superpowers/reviews/walkthrough.md` 属于 MiMo/Aider/SWE-agent 增强记录，不作为本轮 TUI 渲染证据。
- 未发现仓库内存在 `task.md`，本轮按仓库既有严格流补充此 review/walkthrough 文件作为收尾痕迹。
- 增补了非法 pipe 日志降级测试，避免 `status=200 | ...` 或股票接口原文被误判为 Markdown 表格。
- 增补了长段落与长列表软换行测试，确保普通输出不只依赖表格压缩。

## Verification

收尾过程中已运行：

```powershell
npm run build
node --test tests\unit\tui-markdown.test.mjs tests\unit\streaming-tui-ctrl-c.test.mjs tests\unit\tui-shell.test.mjs
```

当前定向测试结果：

- 56 tests
- 56 pass
- 0 fail

最终提交前仍需运行完整验证：

```powershell
npm run ci:check
rg -n "<legacy project name variants>" . -g "!node_modules/**" -g "!dist/**" -g "!.git/**"
git diff --check
npm audit --registry=https://registry.npmjs.org --audit-level=high
```
