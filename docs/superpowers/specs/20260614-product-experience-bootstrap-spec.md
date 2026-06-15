# Product Experience Bootstrap Spec

## Goal

Improve first-run experience for local Qling users without changing model calls, storage formats, daemon semantics, dashboard behavior, or slash command APIs.

## Requirements

- Add a local bootstrap path for source checkout users and installed CLI users.
- Keep defaults safe and minimal: no dashboard, semantic memory, or dynamic discovery unless explicitly selected.
- Shorten `qling setup` around provider/model/API key, with advanced options behind a single opt-in branch.
- Replace blocking onboarding tutorial with a concise first-run card.
- Make top-level help and CLI errors point to the next actionable local command.
- Keep all diagnostics local and secrets redacted.

## Public Interfaces

- `npm run bootstrap -- [--with-browser|--no-browser] [--profile minimal|dev]`
- `qling bootstrap [--yes] [--with-browser|--no-browser] [--profile minimal|dev]`
- `qling setup` remains the setup command and writes the same `.env` style values.

## Non-goals

- No cloud deployment, Docker deployment, GitHub App setup, desktop/mobile handoff, or dashboard redesign.
- No new TUI dependency or full-screen alt-screen UI.
- No changes to session, memory, token, or slash command storage/API contracts.

## Acceptance

- New bootstrap mode is visible in parser and help.
- Missing API key diagnostics recommend `qling bootstrap` and `qling setup`.
- TUI startup/redraw uses the new onboarding card and action-oriented input placeholder.
- CLI errors include cause, next step, example, and local/model-call boundary.
- Legacy English project casing remains absent from repo scans.
