# Portable Runtime Closure Spec

## Problem

The v1.2.1 Windows portable archive contains the packed Qling files and Node runtime but no production `node_modules`. Both `qling.exe --version` and `qling.exe doctor` fail immediately with `ERR_MODULE_NOT_FOUND` for `dotenv`.

## Desired behavior

1. The portable archive contains all production runtime dependencies.
2. Native production dependencies are usable by the bundled Node runtime.
3. The build fails before creating a releasable zip if the staged launcher cannot start.
4. Scoop manifests reference the immutable hash of the verified archive.

## Scope

- Install production dependencies into the staged npm package.
- Rebuild the native `better-sqlite3` dependency for the build runtime.
- Run staged `qling.exe --version` and `qling.exe doctor` checks before zipping.
- Keep the mirrored Scoop manifest hash synchronized.

## Non-goals

- No change to CLI runtime behavior.
- No replacement of the existing Node or .NET launcher strategy.
- No automatic GitHub Release replacement or package-manager submission.

## Acceptance criteria

- The currently published v1.2.1 archive is recorded as a failing RED artifact.
- A newly built archive passes SHA256 verification, `--version`, and `doctor` from an isolated extraction directory.
- Packaging validation and the repository verification gates pass.

