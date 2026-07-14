# Cross-platform CI Repair Spec

## Problem

The `ci` workflow fails on both supported runners even though the focused tests pass on the local Windows checkout.

- Windows converts `skills/opencli/SKILL.md` to CRLF. `parseFrontmatter` splits on `\n` and rejoins lines without removing the remaining `\r`, causing the YAML parser to return the empty fallback metadata.
- Linux uses POSIX `path.basename` for every input. A Windows-style `targetPath` is therefore treated as one long filename, so equivalent failures on different Windows roots produce different fingerprints.

## Desired behavior

1. Skill frontmatter parses identically from LF and CRLF files.
2. Failure fingerprints use the basename implied by the path syntax, independent of the host OS.
3. Existing skill discovery, recovery classification, and fingerprint behavior remain unchanged.

## Scope

- Normalize line endings at the frontmatter parsing boundary.
- Select `path.win32.basename` for drive-letter or backslash paths and `path.posix.basename` otherwise.
- Add host-independent regression tests for CRLF frontmatter and Windows paths.

## Non-goals

- No packaging, release, WinGet manifest, or Scoop manifest changes.
- No broad YAML parser replacement.
- No changes to fingerprint hashing or recovery policy.

## Acceptance criteria

- New regressions fail before the production fix and pass afterward.
- The focused unit tests pass locally.
- `npm run ci:check`, `node scripts/eval-recovery.mjs`, `npm audit`, and `git diff --check` pass.
- A fresh GitHub Actions run for the pushed fix passes on Windows and Linux before the CI issue is called resolved.

