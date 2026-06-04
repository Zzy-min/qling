# Full qling Namespace Rename Plan

1. Add RED coverage or update existing contracts for `QLING_*` env names and `.qling` state paths.
2. Apply controlled whole-repo textual rename for `qling`, `Qling`, and `QLING`.
3. Fix any identifier, import, or test breakage caused by the namespace change.
4. Verify no old namespace remains outside ignored/build artifacts.
5. Run build, audit, full CI, then commit and push.
