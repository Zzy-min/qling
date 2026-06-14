# qling README 重写 spec

> 状态：draft（待实施）
> 目标文件：`README.md`（仓库根）
> 关联版本：qling v0.5.0（CHANGELOG 当前最高条目）

## 1. 背景

旧 README 的核心叙事仍然成立（轻灵是「本地优先的 AI Agent CLI」），但内容上漏掉了 v0.4 / v0.5 已经落地的重要能力：

- 缺少 `qling daemon` 后台守护进程（v0.5）
- 缺少 `qling dashboard` 本地白盒观测台（v0.3）
- 缺少 `qling discovery sync` 动态插件 / 技能同步（v0.3）
- 缺少 `qling workflow resume` 状态机 checkpoint 恢复
- 项目结构表漏掉 `src/channels/`（Telegram / Slack 通道）、`src/dashboard-server.ts`、`src/daemon.ts`
- 把 Browser Fetch 描述成"可选 Playwright"，但 v0.5 已经把它列为"已集成"
- 跑得通的命令（mission 系列含中文别名 / `daemon` / `dashboard`）和 README 描述的"管理命令"不一致
- v0.3 Channels（Slack / Telegram）完全没有出现

本次重写只动 `README.md` 一个文件，不改任何代码，不动 CHANGELOG，不动 LICENSE。

## 2. 目标受众与使用场景

- 主要受众：中文开发者，独立使用 / 局域网使用 Agent CLI。
- 次要受众：在本地工作流里嵌入 qling 作为脚本型 Agent 的工程师。
- 读者在 README 中需要立刻回答的 5 个问题：
  1. 这是什么 / 不是什么（不是 Claude Code 复制品）。
  2. 装起来要做什么（`npm install && npm run build`，`.env`）。
  3. 上手 4 个命令（`qling`、`qling chat`、`qling run`、`qling setup`）。
  4. 完整的命令面（CLI / slash 两条线）。
  5. 数据落点与隐私边界。

## 3. 信息架构（自上而下）

1. 标题 + 一句话定位 + 三段徽章式简介（构建 / 许可 / Node 要求）
2. 为什么是轻灵：把"对比表"挪到第二屏，并明确本地优先 vs 平台专属能力的边界
3. 快速开始：环境要求 → 安装 → 配置 → 跑通 4 个命令
4. 运行模式：`qling` / `chat` / `repl` / `run` / `--continue` / `--resume` / 守护进程
5. 命令面板：CLI 顶层管理命令 + TUI 内 `/` slash 命令（合并为一张总表 + 子表）
6. TUI 快捷键
7. 内置工具（与 `src/tools/*.ts` 对齐）
8. 数据与隐私：state / cache / memory 路径
9. 项目结构（按 `src/` 实际目录）
10. 使命（Mission）后台任务概念
11. 开发与验证脚本
12. 设计原则 / License

## 4. 必须保留的事实信息

所有命令名、子命令路径、配置变量、目录结构都从源码验证得出，下表是**不可改写的事实清单**：

### 4.1 CLI 顶层 mode

来源：`src/cli/startup-contract.ts` `KNOWN_MODES`

```
help, run, chat, repl, workflow, memory, dashboard, discovery, setup,
mission, daemon, agents, logs, doctor, status, storage, exports,
sessions, checkpoint, tasks, goal, privacy, context, shortcuts,
statusline, recap, permissions, config, mcp, hooks
```

### 4.2 关键脚本（package.json）

```
build     : tsc
start     : node dist/index.js
tui       : node dist/index.js chat
repl      : node dist/index.js repl
exec      : node dist/index.js run
daemon    : node dist/daemon.js
test      : npm run build && node --test tests/unit/**/*.test.mjs
test:smoke: npm run build && node --test tests/smoke/**/*.test.mjs
ci:check  : build + unit + smoke
```

### 4.3 全局参数

```
--config, --workspace, --no-workspace,
--continue, --resume, --file-cache-dir, --file-state-dir,
--inspect-prompt, --inspect-request,
--log-format (text|json), --log-level (debug|info|warn|error),
--model, --provider, --endpoint, --api-key
```

### 4.4 内置工具（src/tools/）

```
bash, read, write, search, planner, skill, todo,
url-fetch, browser-fetch, subtask, vision-analyze
```

### 4.5 关键目录

```
src/
  agent-loop.ts          Agent 主循环
  agent/                 subtask 隔离 agent
  channels/              Telegram / Slack / console 通道
  cli/                   startup contract + setup + daemon control
  commands/              slash 命令实现
  dashboard-server.ts    本地观测 HTTP 服务
  daemon.ts              qlingd 后台守护进程
  discovery-*.ts         动态插件 / 技能注册
  guard/                 权限、内容过滤、审计
  mcp/                   MCP stdio + HTTP 客户端
  memory/                WAL / 语义记忆 / 投影
  mission/               使命状态机
  pipeline/              prompt section / hooks / 验证
  session/               会话注册 / goal / task / scheduler
  skills/                本地 skill 注册
  tools/                 工具实现
  tui/                   流式终端 UI
```

## 5. 风格基线

- 语言：简体中文为主，专有名词（Node、TypeScript、Playwright、MCP、SQLite、API、Mission、CLI、TUI）保留英文 / 缩写。
- 句子：短句优先，避免长从句。
- 表格：用于命令清单、目录结构、特性对比，不要堆砌无信息量行。
- 代码块：所有可执行命令必须用 ```` ```bash ````，并确保 `qling` 作为 `bin` 名贯穿。
- 表情：保持原有节制风格（README 现有表情：表头 ✅ ❌ 🚀 🛑 ℹ️ 📡 📁 📊 🧠 ⚠️ 🔄），新内容沿用相同表情集。

## 6. 不允许做的事

- 不写"未来会支持" / "即将到来" / "roadmap"。
- 不引入与代码不符的命令或工具名。
- 不写"agent 完全自主" / "完全云端" / 类似的虚假前提。
- 不在 README 内嵌入大幅宣传语 / 长篇背景故事。
- 不在 README 中粘贴"占位 TODO"段。
- 不重复 CHANGELOG 内容（README 指向 CHANGELOG，不复述）。
- 不复述 docs/ 内部设计文档（README 自洽，复杂设计放 docs/superpowers/specs/）。

## 7. 验收标准

重写后必须满足：

- [ ] `qling` / `qling chat` / `qling run` / `qling setup` / `qling daemon start` 至少出现一次
- [ ] TUI slash 命令 / 顶层 CLI 命令 至少各有 5 条
- [ ] `src/channels/`、`src/dashboard-server.ts`、`src/daemon.ts` 出现在项目结构表
- [ ] Browser Fetch 不再被描述为"可选"
- [ ] 内部命令链接的格式（`/help`、`` ```bash ````）与现有风格一致
- [ ] 文件行数不超过 380 行（信息密度优先，必要时可到 450）
- [ ] 所有命令在 `npm run build` 通过的前提下能被 `qling help` 与 `qling <subcommand> --help` 验证存在（实施步骤里跑一次 `qling help` 摘录）
- [ ] 不引入相对路径下不存在的文件引用

## 8. 实施步骤

1. 写本 spec（已落 `docs/superpowers/specs/qling-readme-rewrite.md`）
2. 跑一次 `npm run build` 确保 dist 是干净的，作为基线
3. 用 `dist/index.js help`（或 `node dist/index.js help`）摘出顶层命令清单做交叉验证
4. 改写 `README.md`
5. 再跑一次 `npm run build` 与 `npm test` 做新鲜验证
6. `git add README.md docs/superpowers/specs/qling-readme-rewrite.md`
7. `git commit -m "docs: rewrite readme around qling v0.5"`
8. `git push origin main`

## 9. 风险

- **命令清单与代码漂移**：通过 `qling help` 输出做交叉验证缓解。
- **项目结构表过期**：按 `src/` 实际目录重写而不是照抄旧 README。
- **审稿方偏好**：保留与旧 README 类似的对照表结构（"轻灵 vs 其他"）以减少视觉冲击。
- **CHANGELOG 与 README 重复**：本次不复制 CHANGELOG，仅在末尾指明 "见 CHANGELOG.md"。
