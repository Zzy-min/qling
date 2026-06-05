# TUI Bracketed Paste Spec

## Goal

Make pasted multi-line prompts safe and predictable in the qling TUI, matching native terminal expectations and avoiding accidental submission.

## Scope

- Recognize bracketed paste start/end sequences: `ESC [ 200 ~` and `ESC [ 201 ~`.
- Insert pasted text into the local input buffer.
- Convert pasted `\r` and `\n` into input-buffer newlines.
- Do not submit pasted multi-line content while paste mode is active.
- Do not retain bracketed paste control sequences in the input buffer.
- Mention paste behavior in shortcut help.

## Non-Goals

- No clipboard integration.
- No model calls, tool calls, network access, or disk writes.
- No automatic paste sanitization beyond stripping terminal bracket markers.

## Acceptance Criteria

- A bracketed paste chunk containing newlines leaves the full pasted text in the input buffer.
- The paste start/end escape sequences are not present in the buffer.
- No command is submitted during paste.
- Normal Enter after paste still submits the full trimmed input.
- Existing shortcut, history, and exit tests keep passing.
