# qling Command Rename Plan

## Scope

Unify the current official English CLI command surface from `qingling` to `qling` while preserving the Chinese name `轻灵` and local data compatibility.

## Steps

1. Add or adjust RED tests:
   - package metadata exposes only the `qling` bin;
   - top-level help and focused help use `qling`;
   - typo suggestions and deprecated flag warnings point to `qling`.
2. Update package metadata:
   - package name to `qling`;
   - root package-lock metadata to `qling`;
   - bin map to expose `qling` only.
3. Update user-facing command strings in source:
   - `src/cli/startup-contract.ts`;
   - `src/help-topics.ts`;
   - `src/index.ts`;
   - setup/report hints that mention command examples.
4. Update current product docs:
   - README and non-archival command examples such as CHANGELOG/blog snippets.
5. Keep local data and config stable:
   - do not rename `.qingling`;
   - do not rename `QINGLING_*` env vars.
6. Verify:
   - `npm run build`;
   - targeted unit tests for CLI/help/package surfaces;
   - relevant CLI startup smoke tests;
   - `npm run ci:check`.

## Risks

- Removing the `qingling` bin may break existing shell muscle memory after relink. This is intentional for command unification, but user-facing docs and errors must consistently point to `qling`.
- Broad text replacement can accidentally rename env vars or local state paths. Search/replace must avoid `QINGLING_*`, `.qingling`, and archival specs/plans unless they are current acceptance docs for this rename.
