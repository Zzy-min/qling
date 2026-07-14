# Cross-platform CI Repair Plan

1. Add a CRLF variant to the frontmatter regression test and a host-independent Windows-path basename case to the failure-fingerprint test.
2. Run only those focused tests and capture the intended RED failures.
3. Commit the RED checkpoint.
4. Normalize CRLF input before YAML frontmatter parsing.
5. Resolve target basenames according to the input path syntax rather than the runner OS.
6. Re-run the same tests and capture GREEN, then commit the fix checkpoint.
7. Run the repository gates: `npm run ci:check`, recovery evaluation, audit, and diff check.
8. Review the diff for correctness and security regressions.
9. Push only after user approval, then wait for a fresh cross-platform GitHub Actions result.
10. Provision Playwright Chromium in Linux CI so the required dashboard responsive E2E test runs instead of failing before launch.

External packaging follow-up is separate:

- WinGet: CLA is already green; do not change manifests while validation run 4 is still stuck. Await or request a maintainer rerun, then act on the actual validation result.
- Scoop Extras: do not reopen now. Keep the self-owned bucket healthy, fix the stale release hash, add installation verification, and build adoption evidence before a package-request issue and future reopen.
