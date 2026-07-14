# Example skills pack

Bundled under `skills/examples/` and discovered by Qling's progressive skill loader.

| Skill | Purpose |
|-------|---------|
| `repo-triage` | Map an unfamiliar repository quickly |
| `fix-failing-test` | Reproduce, patch, and re-verify a red test |
| `add-function` | Add an exported function with minimal diff |
| `pr-summary` | Draft PR / release notes from git history |

## Usage

```text
/skill list
/skill fix-failing-test
/skill add-function
/skill pr-summary
```

Copy the template at `skills/templates/SKILL.md` to create your own under `~/.qling/skills/` or the project `skills/` directory.

See [docs/skills.md](../../docs/skills.md).
