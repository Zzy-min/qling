# qling Command Rename Spec

## Background

The project keeps the Chinese product name `轻灵`, but the English command and user-facing English name should be `qling`. The current CLI still advertises and packages `qling` in command examples, help text, errors, and package metadata.

## User Journey

As a local Qling user, I want every official command example and CLI hint to use `qling`, so that the English command surface is short, consistent, and easy to remember while the Chinese name remains `轻灵`.

## Requirements

1. The Chinese product name `轻灵` must remain unchanged in banners and Chinese descriptions.
2. The official package/bin command must be `qling`.
3. `qling` must not remain as an official package bin.
4. Current user-facing command help, focused help, error suggestions, deprecation warnings, setup hints, README command examples, and non-archival product docs must use `qling`.
5. Existing CLI subcommands and Chinese aliases must keep their behavior under the `qling` command surface.
6. Tests must cover the package/bin contract and representative command help/error surfaces.
7. The implementation must not rename or migrate local runtime data directories such as `C:\Users\Lenovo\.qling`.
8. The implementation must not rename existing environment variables such as `QLING_*`.

## Non-Goals

- Rename the repository folder.
- Migrate local state from `.qling`.
- Rename `QLING_*` environment variables or config keys.
- Rewrite archival implementation specs/plans that describe historical command names.
- Change model, network, or storage behavior.

## Acceptance Criteria

1. A RED test proves package metadata still exposes `qling` instead of only `qling`.
2. A RED test proves core help or command suggestions still advertise `qling`.
3. README and current user-facing source messages show `qling` for commands.
4. `npm run ci:check` passes after implementation.
