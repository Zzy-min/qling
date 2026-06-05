# `qling` TUI 行编辑快捷键规格（2026-06-05）

## 背景

TUI 已支持基础字符输入、左右移动、退格、多行输入、历史搜索和双 `Ctrl+C` 退出。为了更接近 Claude Code/终端的顺滑输入体验，常用行编辑快捷键仍缺失：跳到输入首尾、删除光标前后内容。

## 目标

- 支持 `Ctrl+A` 将光标移动到输入开头。
- 支持 `Ctrl+E` 将光标移动到输入结尾。
- 支持 `Ctrl+U` 删除光标前的内容，保留光标后的内容。
- 支持 `Ctrl+K` 删除光标后的内容，保留光标前的内容。
- 所有快捷键只修改当前进程内的输入缓冲区。
- 不提交输入、不调用模型、不联网、不写磁盘。

## 非目标

- 不实现按行删除，只按当前完整输入缓冲区处理。
- 不新增持久历史格式。
- 不改变 `Ctrl+N` 多行、`Ctrl+R` 搜索历史、`Ctrl+C` 清空/退出语义。

## 行为

- `Ctrl+A` 等价于把 `cursorPos` 设为 `0`。
- `Ctrl+E` 等价于把 `cursorPos` 设为 `value.length`。
- `Ctrl+U` 删除 `[0, cursorPos)`，删除后 `cursorPos=0`。
- `Ctrl+K` 删除 `[cursorPos, value.length)`，删除后 `cursorPos` 不变。
- 每次编辑后重绘输入栏并同步光标。

## 验收

- `InputBuffer` 单测覆盖首尾移动和删除前后内容。
- `StreamUI` 单测覆盖快捷键不会调用 input callback。
- 目标单测、`npm run build`、`npm run ci:check` 通过。
