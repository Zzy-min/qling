# Qling (轻灵)

[![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)](#requirements)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.0-orange.svg)](CHANGELOG.md)
[![Release](https://img.shields.io/github/v/release/Zzy-min/qling?display_name=tag&sort=semver)](https://github.com/Zzy-min/qling/releases)

**Qling** is a **local-first** AI Agent CLI workbench. It keeps sessions, tools, skills, permissions, diagnostics, long-running missions, and recovery controls in one auditable terminal console.

> One line: Qling turns the agent into a local workbench—not a black-box chat window.

**Chinese docs:** [README.md](README.md) · **Install:** [docs/install.md](docs/install.md) · **Skills:** [docs/skills.md](docs/skills.md) · **Demo notes:** [docs/demo.md](docs/demo.md)

## Why Qling

| Dimension | Approach |
|---|---|
| Local-first | Sessions, checkpoints, exports, memory, and diagnostics stay on disk; `qling privacy` shows boundaries. |
| Chinese UX | TUI, help, and slash aliases target Chinese terminals (English works too). |
| Recoverable | `/checkpoint`, `/resume`, `/recover`, staged verification, execution traces. |
| Governed tools | Permission matrix, approval gate, content filter, audit log. |
| Honest boundaries | Unsupported cloud features are explained—never faked. |

## What's new in 1.1

- Deterministic recovery strategies + staged verification (`eval:recovery`)
- Leaner agent core: LLM client, tool orchestration, main loop, system prompt extracted from the monolith
- Coding precision: atomic patch writes, repo-map/search budgets, bilingual tool-output fold, CJK width
- Windows unit CI alongside full Ubuntu `ci:check`
- Sprint 4 ecosystem: `eval:tasks` fixtures, packaging validators, example skills pack

## Requirements

- Node.js ≥ 18
- npm ≥ 9
- Optional: Playwright Chromium for `browser_fetch` / `browser_act`

## Install

### From source (recommended today)

```bash
git clone https://github.com/Zzy-min/qling.git
cd qling
npm run bootstrap
# optional browser tools:
npm run bootstrap -- --with-browser
npm link
qling --version
```

### From npm (published)

Package name is scoped: **`@qlingzzy/qling`** (CLI binary remains `qling`):

```bash
npm install -g @qlingzzy/qling --registry https://registry.npmjs.org/
qling bootstrap
qling setup
```

From GitHub without npm registry:

```bash
npm install -g github:Zzy-min/qling
```

> `better-sqlite3` is a native module. On Windows install [VS Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) if prebuilds are unavailable.

### Windows: Scoop / winget drafts

Drafts live under `packaging/` and are **not** in official catalogs yet:

```powershell
npm run validate:packaging
```

See [docs/install.md](docs/install.md) for PowerShell env vars, Scoop notes, and winget submission checklist.

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

Any OpenAI-compatible endpoint works via `QLING_LLM_ENDPOINT` + `QLING_LLM_MODEL`. Local models: `/model use ollama`.

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
/skill list    progressive skills index
/expand        expand long tool output
/recover       execution recovery controls
/verify        verification command / stages
/doctor        environment check
/privacy       data boundaries
```

Shift+Tab cycles agent modes in the TUI.

## Skills

Progressive skills: short index in the system prompt; full body loaded on demand via `skill` tool or `/skill`.

Bundled examples (`skills/examples/`):

| Skill | Use when |
|-------|----------|
| `repo-triage` | Onboarding an unfamiliar repo |
| `fix-failing-test` | Red unit tests |
| `add-function` | Small exported API addition |
| `pr-summary` | PR / release notes from git |

Also: `opencli`, lifecycle suite (`lifecycle-spec` … `lifecycle-ship`), template at `skills/templates/SKILL.md`.

Details: [docs/skills.md](docs/skills.md).

## Eval & quality gates

```bash
npm test                 # unit
npm run test:smoke
npm run eval:smoke       # local policy/presets smoke
npm run eval:recovery    # recovery planner fixtures
npm run eval:tasks       # 10 coding repo fixtures (no LLM)
npm run validate:packaging
npm run ci:check         # CI entry (ubuntu); windows runs unit
# optional with key:
QLING_EVAL_LLM=1 npm run eval:llm
```

## Design principles

- **Local-first** — valuable state stays on the machine.
- **Slash-first** — discover controls from `/`.
- **Recoverable** — checkpoint / resume / recover / verify.
- **Honest boundaries** — no fake success for unsupported features.
- **Terminal-native** — enhance TUI without heavy GUI deps.

## Packaging status (honest)

| Channel | Status |
|---------|--------|
| Source + bootstrap | Ready |
| npm `@qlingzzy/qling` | **Published** `1.1.0` — install with `--registry https://registry.npmjs.org/` if your default is a mirror |
| Scoop | Draft + real tarball SHA256; not in official buckets |
| winget | Draft YAML only (needs portable zip + SHA256) |
| Portable zip / single binary | Not yet |

## Version

- Package: `1.1.0` (see latest tag on GitHub for hotfixes)
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Specs / plans: `docs/superpowers/`

## License

[MIT](LICENSE)
