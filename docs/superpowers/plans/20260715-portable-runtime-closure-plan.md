# Portable Runtime Closure Plan

1. Preserve evidence that the released archive fails with missing `dotenv`.
2. Add production dependency installation to the portable staging process without running the root package's prepare lifecycle.
3. Rebuild `better-sqlite3` explicitly for the staged runtime.
4. Add pre-zip launcher checks for `--version` and `doctor`.
5. Build a fresh archive and test it from an isolated extraction directory.
6. Synchronize the verified SHA256 into both Scoop manifests and validate packaging.
7. Run the full repository gates and review the diff.
8. Ask before replacing the published asset, pushing commits, or changing external PRs.
