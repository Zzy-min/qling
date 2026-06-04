# 从零搭建轻灵：一个 TypeScript CLI Agent 框架的诞生

> 用 TypeScript + DeepSeek API 构建你自己的 AI 编程助手，全流程技术博客系列

## 为什么要做轻灵？

2026 年初，Claude Code 的出现让我第一次真正感受到「AI 在终端里写代码」的生产力。但作为一个想深入理解 Agent 原理的开发者，我更想**自己造一个**——从最底层的 ReAct 循环、Tool Calling、到终端 UI 渲染，每一步都亲手实现。

轻灵（Qling）就是这样诞生的。它是一个从零搭建的 TypeScript CLI Agent 框架，目标是：

1. **理解原理**：不封装黑盒 API，而是自己实现 Agent 循环的每个环节
2. **极致轻量**：核心依赖只有 axios + zod，没有 React/Ink 等重型 UI 库
3. **生产可用**：带记忆、压缩、验证、TUI 界面，不只是 Demo

## 系列目录

| 篇章 | 内容 | 适合谁 |
|------|------|--------|
| **第1篇：架构总览** | 项目结构、技术选型、核心设计决策 | 所有人 |
| **第2篇：Agent Loop** | ReAct 循环、Tool Calling、上下文管理 | 想理解 Agent 原理的人 |
| **第3篇：流式 TUI** | Claude Code 风格终端界面、ANSI 控制 | 想做终端 UI 的人 |
| **第4篇：工具与 Pipeline** | 11 个内置工具、Hook/Section/Verification | 想扩展工具的人 |
| **第5篇：记忆与生产化** | 向量记忆、MCP、Mission 系统 | 想做生产级 Agent 的人 |

## 技术栈一览

```
TypeScript (ESM)  +  Node.js 18+
├── HTTP:      axios（带重试拦截器）
├── Schema:    zod（工具参数校验）
├── 存储:      better-sqlite3（记忆 + 向量索引）
├── 浏览器:    playwright（JS 渲染页面抓取）
├── YAML:      yaml（配置解析）
└── ANSI:      string-width（CJK 宽度计算）
```

**为什么选 DeepSeek？**

- 国内访问稳定，延迟低
- `deepseek-chat` 模型原生支持 OpenAI 格式的 Tool Calling
- 价格便宜，适合开发调试
- 也可以切换到 OpenAI / 智谱 / MiniMax 等任何兼容接口

## 从 v0.1 到 v0.5：演进路线

```
v0.1  基础 Agent Loop + 5 个工具 + REPL
  ↓
v0.2  三层记忆架构 + WAL 日志 + MCP 客户端
  ↓
v0.3  语义向量记忆 + Workflow 状态机 + Dashboard
  ↓
v0.4  Slash 命令 + Onboarding 向导 + E2E 测试
  ↓
v0.5  Mission 系统 + Browser Fetch + Daemon 守护进程
```

每篇文章都会对应具体的版本阶段，**你可以按顺序从 v0.1 开始搭建**，逐步演进到 v0.5。

## 快速体验

如果你想先跑起来看看效果：

```bash
git clone https://github.com/Zzy-min/qling.git
cd qling
npm install
npm run build

# 配置 API Key
echo "DEEPSEEK_API_KEY=your-key-here" > .env

# 启动 TUI
node dist/index.js -t
```

好，接下来我们进入第1篇：**架构总览**。

---

*下一篇：[从零搭建轻灵（一）：架构总览与技术选型](./01-architecture-overview.md)*
