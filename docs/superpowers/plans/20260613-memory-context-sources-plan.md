# Memory Context Sources Plan

## Steps

1. Add unit coverage for a read-only memory source report that checks existence without reading session bodies.
2. Add slash command coverage for `/memory sources` and Chinese alias routing.
3. Implement `buildLocalMemorySourcesReport` and formatter in `src/memory-report.ts`.
4. Route `sources` aliases in `src/commands/memory.ts`.
5. Add CLI management routing for `qling memory sources` if the CLI delegates memory subcommands separately.
6. Verify with targeted tests, full CI, old-name scan, diff whitespace check, and audit before commit.

## Risk Controls

- Use filesystem metadata checks only.
- Preserve existing `/memory` default output.
- Keep output local-first and explicit about privacy boundaries.
