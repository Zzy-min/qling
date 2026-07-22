# WinGet launcher and startup repair implementation plan

1. Add a smoke test that compiles the native launcher, invokes it through a Windows file symlink, and proves it loads the staged runtime and entry point.
2. Add a CLI smoke test that removes all supported API-key variables and proves startup exits with a coded, actionable message and no stack trace.
3. Implement final-path resolution in the C# launcher with a safe fallback.
4. Move `AgentLoop` construction inside the CLI lifecycle boundary and add a stable missing-key error code/message.
5. Bump package and lockfile to 1.3.1, add changelog notes, create a new 1.3.1 WinGet manifest set, and update local Scoop/WinGet draft metadata.
6. Run focused RED/GREEN tests, build the real portable ZIP, execute direct and symlink smoke checks, synchronize SHA256, and validate packaging.
7. Run the full CI gate, recovery evaluation, diff check, secret/path scan, and review the final diff without staging the unrelated Devpost draft.

If any artifact or validation step fails, retain the previous 1.3.0 manifests and do not claim that 1.3.1 is releasable or update the external WinGet PR.
