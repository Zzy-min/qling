# Spec: MiMo-inspired Tab agents view

MiMo-Code advertises `Tab` as a fast way to switch agents from the terminal. Qling does not currently have a true active-agent switcher, so copying that behavior would create a misleading control. The aligned local-first version is to make `Tab` a discoverable shortcut to the existing local `/agents` mission view when the input buffer is empty.

## Goals

- Empty-input `Tab` must dispatch the existing local `/agents` command path.
- Non-empty-input `Tab` must not insert a tab character, submit the draft, or overwrite the draft.
- Non-empty-input `Tab` must print local feedback that agent switching/completion is not active for the current draft.
- The TUI header and `/shortcuts` output must document the `Tab` behavior.

## Non-goals

- Do not add a new agent-switching runtime or active-agent state.
- Do not call the model, upload data, or read unrelated session bodies.
- Do not change `/agents` output semantics.

## Verification

- Unit tests cover direct `Tab` handling and raw stdin `\t` dispatch.
- `npm run build && node --test tests\unit\streaming-tui-ctrl-c.test.mjs`
- `npm run ci:check`
