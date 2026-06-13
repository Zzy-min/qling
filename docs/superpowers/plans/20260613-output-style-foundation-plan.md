# Plan: Output style foundation for local reports

1. Add RED unit tests for a shared output-style formatter.
2. Tighten context report formatter tests to expect branded title, section labels, aligned rows, and local boundary wording.
3. Implement `src/output-style.ts` with pure formatting helpers.
4. Refactor `formatContextReport()` to use the shared formatter without changing report fields or data collection.
5. Verify with:
   - `npm run build && node --test tests\unit\output-style.test.mjs tests\unit\context-report.test.mjs`
   - `npm run ci:check`
   - old-name scan, diff checks, audit, staged checks.
