# TUI Bracketed Paste Plan

## Steps

1. Add failing tests for bracketed multi-line paste behavior through the stdin data handler.
2. Extend raw input parsing to accumulate multi-digit CSI sequences and track paste mode.
3. Insert pasted characters locally, converting CR/LF to input-buffer newlines without submitting.
4. Update shortcut help to document safe multi-line paste.
5. Verify with targeted tests, full CI, audit, old-name scans, and push to GitHub.

## Risk Controls

- Keep paste state inside the TUI input handler closure.
- Treat unknown escape sequences as terminal controls, not text.
- Do not write pasted content to disk or send it to the model until the user explicitly submits.
