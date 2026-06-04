# Help Flag Topic Routing

## Summary
- 让 CLI 帮助入口更贴近常见命令行习惯：`qling --help exports` 和 `qling exports --help` 都进入同一个聚焦帮助。
- 该能力只改变启动参数解析，不读取本地运行态、不调用模型、不联网。
- 弱化记忆负担：用户不必只记住 `qling help <topic>` 这一种写法。

## User Journey
- 作为 CLI 用户，我输入 `qling --help exports` 时，希望看到 `exports` 聚焦帮助，而不是总帮助。
- 作为 CLI 用户，我输入 `qling exports --help` 时，希望看到该本地命令的帮助，而不是把 `--help` 当作 count 参数。
- 作为输错命令的用户，我输入 `qling expors --help` 时，希望进入聚焦帮助的错拼建议，而不是丢失 `expors` 这个上下文。

## Requirements
- `--help <topic>` / `-h <topic>` 必须把非 option 的 topic 保留到 `decision.subArgs`。
- 本地管理命令后接 `--help` / `-h` 必须转成 `help` mode，并以该命令 id 作为 topic。
- 未识别单 token 后接 `--help` / `-h` 必须转成 `help` mode，并以该 token 作为 topic，以便复用帮助主题错拼建议。
- 纯 `--help` 和现有“help 优先级高于其他模式”的兼容行为保持不变。
- 该改动不改变 `run/chat/repl` 的执行行为，不新增模型调用或远程依赖。

## Non-Goals
- 不新增 help topic 表内容。
- 不为子命令生成多级帮助，例如 `permissions explain --help` 仍聚焦到 `permissions`。
- 不改变 help 输出格式本身。

## Acceptance
- `parseCliArgs(["--help", "exports"])` 返回 `mode: "help"` 且 `subArgs: ["exports"]`。
- `parseCliArgs(["exports", "--help"])` 返回 `mode: "help"` 且 `subArgs: ["exports"]`。
- `parseCliArgs(["导出列表", "-h"])` 返回 `mode: "help"` 且 `subArgs: ["exports"]`。
- `parseCliArgs(["expors", "--help"])` 返回 `mode: "help"` 且 `subArgs: ["expors"]`。
- `parseCliArgs(["--help", "--repl", "--once", "x"])` 仍返回 `mode: "help"` 且无 topic。
- smoke 验证 `node dist/index.js --help exports` 和 `node dist/index.js exports --help` 都退出 `0`，输出聚焦帮助，且不泄露环境密钥。
