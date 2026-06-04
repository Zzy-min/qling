# Full qling Namespace Rename Spec

## Goal

Rename every remaining English `qling` namespace surface to `qling`.

## Scope

- Replace lowercase `qling` with `qling` in current docs, specs, plans, code strings, tests, temp prefixes, URLs, and path examples.
- Replace title-case `Qling` with `Qling`.
- Replace uppercase `QLING` environment variable prefixes with `QLING`.
- Change default local state/cache naming from `.qling` to `.qling`.
- Keep the Chinese name `轻灵` unchanged.

## Acceptance

- Repo search outside `.git`, `node_modules`, and `dist` returns no `qling`, `Qling`, or `QLING`.
- Help output and README show `qling` only.
- Build, audit, unit/smoke CI pass before push.
