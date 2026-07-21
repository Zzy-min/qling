# Qling — OpenAI Build Week submission kit

> Deadline: July 21, 2026, 5:00 PM PT (July 22, 2026, 08:00 Beijing time).
> Repository: https://github.com/Zzy-min/qling (public; no reviewer sharing required).

## Devpost copy

### Project title

Qling (轻灵) — A local-first AI agent workbench for Chinese developers

### One-line description

Qling turns an AI coding agent into an auditable, recoverable local terminal workbench with a streaming Chinese TUI, explicit approvals, durable tasks, local memory, and built-in diagnostics.

### Inspiration

Most agent interfaces optimize for a single successful chat. Real development work is longer lived: commands need approval, context gets compacted, terminals close, tasks fail, and users need to understand what the agent changed. Qling was built to make those workflows visible and recoverable, especially for Chinese-speaking developers working locally.

### What it does

- Provides a streaming, slash-first terminal UI with Chinese-first help and command aliases.
- Separates Normal, Auto, and Plan modes, including interactive approval for sensitive tools and explicit plan approval before implementation.
- Keeps sessions, checkpoints, memory, tasks, and diagnostics local by default.
- Supports resumable workflows, durable missions, background tasks, and recovery after failures.
- Exposes explainable permission rules, privacy boundaries, token usage, configuration, MCP, hooks, and diffs from the CLI.
- Includes a localhost-only dashboard for inspecting tasks and recent execution activity.

### How it was built

Qling is written in TypeScript on Node.js. Its agent loop coordinates OpenAI-compatible model calls, tool execution, permission checks, hooks, memory, sessions, and recovery. The terminal UI renders streaming output and interactive overlays without requiring a browser. The project uses Node's test runner for unit and smoke coverage, Playwright for the dashboard browser test, deterministic local evaluation fixtures, packaging validation, and dependency-layer checks.

Codex was used for repository exploration, spec and plan work, implementation, regression debugging, and verification across the codebase.

**Before submission, add one truthful sentence describing the exact GPT-5.6 work performed in this project. Do not submit a generic or invented claim.**

Suggested structure after completing that work:

> GPT-5.6 was used to [specific design, implementation, evaluation, or review task], and its output was validated by [specific test, diff, or runtime check].

### Challenges

- Keeping terminal redraws stable while streaming output and showing interactive approval overlays.
- Making approval behavior consistent across the TUI and headless JSON execution.
- Preserving useful local state while keeping secrets and message content out of optional telemetry.
- Testing Windows and Linux behavior, including paths, CJK terminal width, native dependencies, and browser-based dashboard checks.

### Accomplishments

- A public npm package and GitHub release with Windows, Linux, and macOS support.
- More than 1,000 unit assertions plus end-to-end smoke coverage.
- Deterministic local evaluations for task execution, recovery, and anchored edits.
- A local-first permission and privacy model with explicit inspection commands.

### What we learned

Agent reliability is not only model quality. Clear state, narrow permissions, reproducible tests, recoverable sessions, and honest failure messages are equally important. A terminal-native agent also needs dedicated interaction tests because cursor movement, CJK width, paste behavior, and asynchronous progress output can regress independently of the agent loop.

### What's next

- Finish production hardening for the interactive approval and Plan-mode workflow.
- Expand real-world recovery and task evaluations.
- Improve install packaging and first-run diagnostics.
- Add more provider-neutral examples and community skills without weakening local privacy defaults.

## Three-minute demo and required voiceover

Keep the final video under three minutes. Upload it to YouTube as public or unlisted before editing the Devpost form.

### 0:00–0:20 — Problem and product

Show the repository and launch `qling`.

Voiceover:

> Qling is a local-first AI agent workbench for Chinese developers. It combines a streaming terminal UI, explicit permissions, recoverable sessions, durable tasks, and local diagnostics so the agent is not a black box.

### 0:20–0:55 — Local diagnostics and privacy

Run:

```text
/doctor
/privacy
/context
```

Explain that session state is local, secrets are redacted, and runtime context is inspectable.

### 0:55–1:30 — Normal mode approval

In Normal mode, request a command that requires approval. Show the three choices: allow once, always allow for this session, and deny.

Voiceover:

> Sensitive tool calls stop at an explicit approval surface. A one-time approval does not silently widen future permissions, while a session grant is visible and temporary.

### 1:30–2:05 — Plan mode

Switch to Plan mode with `Shift+Tab`, request a small change, then run `/plan approve`. Show the preview and the implement, revise, and quit choices.

Voiceover:

> Plan mode is read-only and writes a reviewable plan artifact. Implementation starts only after an explicit approval decision.

### 2:05–2:35 — Recovery and tasks

Show `/checkpoint`, `/tasks`, or `/recover`, then briefly open the local dashboard if it is already running.

Voiceover:

> Qling keeps long-running work inspectable and recoverable. Sessions, checkpoints, tasks, and mission state can be resumed instead of restarted from scratch.

### 2:35–2:55 — Codex and GPT-5.6

Voiceover must truthfully state both tools' concrete roles. Use this only after completing and recording the missing GPT-5.6 task:

> I used Codex to inspect the repository, implement the approval workflow, repair regressions, and run the full verification gate. I used GPT-5.6 to [specific completed task], then validated it with [specific evidence].

### 2:55–3:00 — Close

Show the public repository URL and the Devpost project name.

## Final submission checklist

- [x] Repository is public: https://github.com/Zzy-min/qling
- [x] README contains setup instructions and test commands.
- [x] Repository documents local privacy boundaries and supported platforms.
- [ ] Complete one specific, defensible GPT-5.6 task and update the text above.
- [ ] Run `/feedback` in the official Codex interface and paste the session ID into Devpost.
- [ ] Record the voiceover demo; keep judged content within 3 minutes.
- [ ] Upload the video to YouTube as public or unlisted and paste the URL into Devpost.
- [ ] Add every team member and confirm each invitation is accepted.
- [ ] Save the form, then verify the project is marked **Submitted**, not Draft.
- [ ] Re-open My Projects and verify the submitted state before the deadline.

## Local verification record

- `npm run ci:check`: passed on July 21, 2026.
- Unit suite: 1,010 tests, 1,010 passed.
- Smoke suite: 72 tests, 71 passed, 1 skipped, 0 failed.
- Deterministic evaluations: smoke 22/22, tasks 10/10, anchored edit 20 fixtures with 100% anchored correctness.
- Packaging validation passed; dependency-layer check reported 0 forbidden reverse edges.
- Playwright Chromium was installed locally for the dashboard browser test.

## Fields still requiring external state

- Devpost project URL: `[paste after opening the project]`
- YouTube demo URL: `[paste after upload]`
- Codex `/feedback` Session ID: `[paste from official Codex interface]`
- Exact GPT-5.6 contribution and evidence: `[complete before recording]`
