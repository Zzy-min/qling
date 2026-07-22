# WinGet launcher and startup repair specification

## Goal

Ship Qling 1.3.1 so a WinGet portable alias starts from the real package directory and a missing model API key exits with actionable CLI guidance instead of a JavaScript stack trace.

## Requirements

- `qling.exe` must resolve the final executable target before locating `runtime/node.exe` and `package/dist/index.js`.
- Direct execution from the package directory must retain existing behavior.
- If final-path resolution is unavailable, the launcher must fall back to its current base directory and keep a concise launcher error.
- CLI construction failures, including a missing API key, must pass through the normal coded error renderer.
- A missing API key must recommend `qling setup`, the supported API-key environment variables, and the loopback Ollama option without printing a stack trace or secret values.
- Package, lockfile, changelog, Scoop, and WinGet metadata must identify version 1.3.1. Historical 1.2.x and 1.3.0 manifests remain unchanged.

## Files and data flow

- `packaging/win-launcher/qling-launcher.cs`: resolve the invoked launcher path through the Windows file handle, derive the package root, then spawn the bundled Node runtime.
- `src/agent-loop.ts`: attach a stable error code and actionable message to missing-key failures.
- `src/index.ts`: create and dispose `AgentLoop` inside the existing CLI failure boundary.
- `tests/`: lock down symlink launch and missing-key output.
- `package.json`, `package-lock.json`, `CHANGELOG.md`, `packaging/{scoop,winget}`: synchronize 1.3.1 metadata and the built artifact SHA256.

## State transitions

```text
WinGet alias -> launcher symlink -> final target path -> package root -> bundled node -> CLI
CLI config -> AgentLoop construction -> success OR coded startup failure -> friendly stderr -> exit 1
```

## Validation

- A Windows file symlink to the compiled launcher runs `--version` successfully from another directory.
- With all supported API-key variables absent, `qling` exits 1, mentions setup/configuration, and contains no stack frames.
- Direct launcher `--version` and `doctor` checks still pass.
- `npm run build`, focused tests, `npm run build:portable-win`, packaging validation, full `npm run ci:check`, and `git diff --check` pass.

## Failure and safety handling

- Symlink-test environments without Windows symbolic-link permission report a skipped automated case; final delivery still requires one local real-link smoke run.
- Artifact hashes are generated from the locally built ZIP and are not presented as a published release until GitHub publication occurs.
- No API keys, user paths, or configuration contents enter committed fixtures, release metadata, or PR replies.
- GitHub push, release creation, WinGet PR mutation, and public replies remain separate confirmed actions.
