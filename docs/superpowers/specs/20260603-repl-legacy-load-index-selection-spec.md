# Classic REPL Legacy Load Index Selection Spec

## Background

Classic REPL now prints numbered saved-session lists for `!sessions` and bare `!load`. However, `!load <target>` still treats every target as a raw session reference. If a user sees `1. alpha` and types `!load 1`, Qling tries to restore a session literally named `1` instead of restoring the first listed local session.

## User Journey

As a Qling user in classic REPL, I want to restore a session by the number shown in the local session list, so that listing and resuming sessions is a smooth local workflow instead of requiring manual name or id copying.

## Requirements

1. `!load <positive integer>` must resolve the integer as a one-based index into the current local saved-session list when such a session exists.
2. When `listSessionsDetailed()` is available, numeric selection must use the detailed local list and restore the selected session by its stable restore target.
3. When only `listSessions()` is available, numeric selection must continue to work with legacy local session names.
4. Existing `!load <name>` and `!load <sessionId>` behavior must remain unchanged for non-numeric targets.
5. Out-of-range numeric targets must preserve existing not-found behavior and must not restore a different session.
6. The feature must not introduce model calls, network calls, or message-body reads.

## Non-Goals

- Change slash `/resume` behavior.
- Change saved-session persistence format.
- Add pagination, fuzzy search, or interactive prompts.
- Change the visual format of session-list output.

## Acceptance Criteria

1. A RED unit test proves `!load 2` does not currently resolve to the second detailed local session.
2. A RED unit test proves `!load 2` does not currently resolve to the second legacy `listSessions()` name.
3. Existing `!load <name>` restore behavior remains covered and unchanged.
4. `npm run ci:check` passes after implementation.
