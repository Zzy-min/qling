# Qling 60 秒演示

仓库当前不内置录屏或 GIF，避免二进制历史膨胀和演示内容过期。发布录制内容前必须使用本地真实运行，并移除 API key、用户名和个人绝对路径。

## 演示目标

在 60 秒内证明五件事：本地边界、命令可发现、工具证据链、失败不伪装成功、长任务可脱离终端继续。

## 录制前准备

```bash
qling --version
qling doctor
qling daemon start
```

- 先配置测试 Provider 或本地 Ollama；不要在画面中输入真实密钥。
- 使用没有个人文件名的演示工作区。
- 清理终端历史、用户名、主目录和 token。
- 使用 Windows Terminal 或支持 CJK 宽度的现代终端。

## 60 秒脚本

### 0-10 秒：本地诊断

```bash
qling doctor
```

旁白：

> 默认情况下，状态和诊断都留在本地。Doctor 不调用模型，只读取本机状态与 loopback 服务。

### 10-20 秒：命令可发现

```bash
qling
```

进入 TUI 后输入 `/`，再输入 `/tr` 并按 `Tab`。

旁白：

> 命令是可见的，不会隐藏在提示符后面。Slash 面板可以过滤和补全，但不会替你执行。

### 20-35 秒：运行任务并展示证据链

```text
统计当前仓库 TypeScript 文件数量，并说明你使用了哪些工具。
/trace
/usage
```

旁白：

> 工具开始、结束、用量来源和最终状态都能被检查。这就是证据链。

也可以用 Headless 形式录制结构化事件：

```bash
qling run "只读统计 src 下的 TypeScript 文件数量" --json
```

### 35-48 秒：受控失败与恢复

在专用演示目录中运行一个已知失败、不会修改真实项目的验证任务，然后打开：

```text
/recover status
/trace
```

旁白：

> 工作流会暂停并显示失败分类和恢复上下文，而不是假装成功。达到迭代上限也会标记为 exhausted。

不要在真实仓库中临时破坏代码来制造失败；使用隔离 fixture 或预先准备的失败命令。

### 48-60 秒：后台 Mission

```bash
qling mission start "只读审查当前仓库并生成摘要"
qling dashboard start
```

在 Dashboard 中显示 Mission 状态和 `runId`。

旁白：

> 长时间的工作可以在终端会话结束后继续进行，并能从 Dashboard 或 attach 重新观察。

## 发布前检查

- 总时长不超过 60 秒。
- 没有 API key、Authorization header、Daemon token 或通道 token。
- 没有 `C:\Users\<name>`、`/Users/<name>`、邮箱或私人仓库路径。
- 不把 `paused`、`exhausted`、`failed` 或 `canceled` 说成成功。
- 不宣称未完成的 WinGet/Scoop 官方收录。
- 画面中的版本、命令和 README 当前版本一致。
- 导出视频后完整回看一次，检查裁切、CJK 宽度、ANSI 残留和字幕同步。

## 相关

- [README.md](../README.md)
- [README.en.md](../README.en.md)
- [安装指南](install.md)
- [GitHub Releases](https://github.com/Zzy-min/qling/releases)
