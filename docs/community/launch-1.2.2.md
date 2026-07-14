# Qling v1.2.2 Launch Kit

Use this kit to introduce Qling to builders without overstating adoption or distribution status.

## Core angle

Qling is a local-first Chinese AI agent CLI for developers who want a visible, interruptible workspace rather than an opaque chat window. Its differentiators are recoverable sessions, durable missions, local diagnostics, a streaming TUI, MCP support, and explicit permission boundaries.

Facts to keep accurate:

- npm package: `@qlingzzy/qling@1.2.2`.
- Windows portable release includes Node and passed `qling.exe --version` plus `qling.exe doctor` after a clean remote download.
- GitHub Actions passes on Linux and Windows.
- The public Scoop bucket is available at `Zzy-min/scoop-qling`.
- WinGet is still under external validation and maintainer review. Do not describe it as available yet.

## Developer-community post (Chinese)

> 我做了一个面向中文开发者的本地优先 AI Agent CLI：Qling（轻灵）。
>
> 它不想把 Agent 做成又一个黑盒聊天框，而是把会话、工具调用、权限、任务、恢复和诊断都放进一个能看见、能中断、能继续的终端工作台里。
>
> 1.2.2 重点解决了跨平台和分发可靠性：Windows/Linux CI 全绿；Windows 便携包带 Node 运行时，并在发布前强制跑 `--version` 与 `doctor` 自检；中断任务的状态写入也改为原子持久化。
>
> 适合想要中文 TUI、本地状态留存、MCP、后台 Mission，以及可恢复长任务的开发者。
>
> npm：`npm i -g @qlingzzy/qling --registry https://registry.npmjs.org/`
> Release：https://github.com/Zzy-min/qling/releases/tag/v1.2.2
>
> 我最想收集两类反馈：你最常见的本地 Agent 工作流是什么？以及你希望“可恢复”的任务在什么节点自动停下来让人确认？

## X post (Chinese)

Qling 1.2.2 is out: a local-first Chinese AI agent CLI with streaming TUI, MCP, durable missions, explicit permissions, and recoverable sessions.

This release fixes cross-platform CI, makes session-task persistence atomic, and turns the Windows portable build into a self-checking artifact.

Try: `npm i -g @qlingzzy/qling --registry https://registry.npmjs.org/`

Release link goes in the reply. Looking for real developer workflow feedback, not vanity stars.

## LinkedIn post (English)

I released Qling 1.2.2, a local-first Chinese AI agent CLI for developers who want more control than a chat window provides.

The product focus is operational visibility: a streaming terminal UI, explicit permission boundaries, MCP, durable missions, local diagnostics, and recoverable sessions.

This release was mostly reliability work. We fixed Windows/Linux CI differences, made task-state writes atomic, and changed the Windows portable build so it installs locked production dependencies and verifies its own launcher before packaging.

If you work with long-running coding or automation tasks, I would value feedback on where an agent should pause, surface evidence, and wait for a human decision.

GitHub: https://github.com/Zzy-min/qling

## 60-second demo script

1. Show `qling doctor` and say: “The state and diagnosis stay local by default.”
2. Start the TUI and open slash completion: “Commands are visible, not hidden behind a prompt.”
3. Run one task, then show its tool timeline or dashboard: “This is the evidence trail.”
4. Trigger a controlled verification failure and show the recovery view: “The workflow pauses with the failure context instead of pretending success.”
5. End with `qling mission start` or the dashboard: “Long work can survive the terminal session.”

Before publishing a recording, use an actual local run, remove API keys and personal paths, and keep the clip under 60 seconds.
