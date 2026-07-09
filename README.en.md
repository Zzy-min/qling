# Qling (轻灵)

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)](#requirements)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-orange.svg)](CHANGELOG.md)

**Qling** is a **local-first** AI Agent CLI workbench. It keeps sessions, tools, skills, permissions, diagnostics, long-running missions, and recovery controls in one auditable terminal console.

> One line: Qling turns the agent into a local workbench—not a black-box chat window.

**Chinese docs:** [README.md](README.md) · **Install details:** [docs/install.md](docs/install.md)

## Why Qling

| Dimension | Approach |
|---|---|
| Local-first | Sessions, checkpoints, exports, memory, and diagnostics stay on disk; `qling privacy` shows boundaries. |
| Chinese UX | TUI, help, and slash aliases target Chinese terminals (English works too). |
| Recoverable | `/checkpoint`, `/resume`, daemon + mission state machines. |
| Governed tools | Permission matrix, approval gate, content filter, audit log. |
| Honest boundaries | Unsupported cloud features are explained—never faked. |

## Requirements

- Node.js ≥ 18
- npm ≥ 9
- Optional: Playwright Chromium for `browser_fetch`

## Install

### From source (recommended today)

```bash
git clone https://github.com/Zzy-min/qling.git
cd qling
npm run bootstrap
# optional browser tools:
npm run bootstrap -- --with-browser
```

Link the CLI globally:

```bash
npm link
qling
```

### After npm publish

```bash
npm install -g qling
qling bootstrap
qling setup
```

### Windows notes

See [docs/install.md](docs/install.md) for PowerShell env vars, Scoop draft, and winget draft.

## Minimal config

**Never** put API keys in committed files. Prefer OS user environment variables.

```bash
# example (do not commit real keys)
QLING_LLM_PROVIDER=deepseek
QLING_LLM_ENDPOINT=https://api.deepseek.com
QLING_LLM_MODEL=deepseek-chat
# set QLING_LLM_API_KEY (or DEEPSEEK_API_KEY) in your shell/OS
```

Interactive wizard (does **not** write secrets into `.env`):

```bash
qling setup
```

Any OpenAI-compatible endpoint works via `QLING_LLM_ENDPOINT` + `QLING_LLM_MODEL`.

## Four commands to try

```bash
qling                   # streaming TUI (chat)
qling run "analyze this repo"
qling doctor            # local diagnostics
qling privacy           # data retention paths
```

## Modes

| Mode | Purpose |
|---|---|
| `qling` / `qling chat` | Streaming TUI |
| `qling repl` | Minimal REPL |
| `qling run "…"` | One-shot task |
| `qling bootstrap` | Local init checks |
| `qling setup` | Provider/model wizard |
| `qling daemon` / `mission` | Background long tasks |

## Useful slash commands

```text
/help          local command map
/model list    provider presets
/model use ollama
/plan on       read-only plan mode
/expand        expand long tool output
/doctor        environment check
/privacy       data boundaries
```

## Design principles

- **Local-first** — valuable state stays on the machine.
- **Slash-first** — discover controls from `/`.
- **Recoverable** — checkpoint / resume / recap.
- **Honest boundaries** — no fake success for unsupported features.
- **Terminal-native** — enhance TUI without heavy GUI deps.

## Version

- Current: `1.0.0`
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Roadmap specs: `docs/superpowers/specs/`

## License

[MIT](LICENSE)
