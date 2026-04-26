# 🎋 轻灵 (QingLing)

**轻灵** (QingLing) — A general-purpose CLI Agent built in TypeScript, powered by the DeepSeek API. It understands natural language tasks and autonomously executes them in the terminal using built-in tools.

Inspired by [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and [Microsoft AI Agents for Beginners](https://github.com/microsoft/ai-agents-for-beginners).

## ✨ Features

- **Agent Loop** — Iterative LLM → Tool Execution → Observe cycle until task completion
- **3-Layer Memory System** — Scratchpad (per-turn) → Conversation (per-session) → Persisted (disk-backed long-term)
- **Auto-Dream Consolidation** — Automatically distills conversation highlights into long-term memories
- **Pipeline Architecture** — Hook-based tool pipeline with Pre/Post execution gates
- **Section-based System Prompt** — Modular, cacheable prompt sections for efficient token usage
- **Verification Agent** — Self-verification with PASS/FAIL/PARTIAL verdicts and multi-step checks
- **Context Compactor** — Smart context compression when approaching token limits
- **Token Budget Manager** — Tracks and manages token usage across turns
- **Knowledge Agent** — Skill-based knowledge loading from Markdown files
- **Streaming TUI** — Claude Code-style terminal UI with real-time streaming output
- **Rich Tool Set** — bash, read, write, todo, skill, planner tools
- **REPL Mode** — Interactive multi-turn conversation with the agent

## 🛠 Tools

| Tool | Description |
|------|-------------|
| **bash** | Execute shell commands |
| **read** | Read file contents with offset/limit pagination |
| **write** | Create or overwrite files |
| **todo** | Persistent task management (list/add/done/cancel/remove/clear) |
| **skill** | Dynamically load knowledge files |
| **planner** | Task planning and decomposition |

## 🏗 Architecture



## 🚀 Quick Start



Or use in development mode:



For interactive REPL mode:



## 💻 Usage Examples



## ⚙️ Configuration

Create a  file (see ):



The agent stores persistent memory in .

## 🧠 Memory System

轻灵 uses a 3-layer memory architecture:

1. **Scratchpad** — Per-turn working memory, cleared each turn
2. **Conversation Memory** — Session-scoped, accumulates during a conversation
3. **Persisted Memory** — Disk-backed long-term storage in 

The **Auto-Dream** feature periodically consolidates conversation highlights into persistent memories, so the agent can learn from past interactions.

## 🔧 Tech Stack

- **Runtime**: Node.js (TypeScript, ES2022, ESNext modules)
- **LLM**: DeepSeek Chat API (OpenAI-compatible)
- **Tool Calling**: Function Calling (OpenAI format)
- **HTTP**: Axios
- **Validation**: Zod
- **UI**: Custom terminal TUI with streaming support

## 📄 License

MIT
