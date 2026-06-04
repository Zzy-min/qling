# Spec: Adding UNIQUE Constraint to task_pattern in distilled_practices

## Problem Description
In `qling` CLI, at the end of a session where the agent learns a best practice, the program invokes `addPractice()` in `CognitiveIndex`.
This function attempts an `INSERT ... ON CONFLICT(task_pattern) DO UPDATE ...` statement (Upsert).
However, SQLite requires that the column specified in the `ON CONFLICT` clause must have a `UNIQUE` or `PRIMARY KEY` constraint.
Currently, the `distilled_practices` table defines `task_pattern TEXT NOT NULL` without `UNIQUE` constraints, leading to the following runtime database crash:
`ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint`

## Proposed Solution
1. **Modify Table Definition**: Update the `CREATE TABLE` query in `CognitiveIndex.init()` to include the `UNIQUE` constraint for `task_pattern`:
   ```sql
   task_pattern TEXT UNIQUE NOT NULL
   ```
2. **Backward Compatibility Migration**: For users with an existing database, the new `CREATE TABLE` statement is ignored. Thus, we will execute:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_distilled_practices_task_pattern ON distilled_practices(task_pattern);
   ```
   To handle cases where existing duplicate entries prevent the unique index creation, a deduplication script will delete non-unique `task_pattern` entries (keeping the first occurrence) and retry.

## Verification Plan
1. Compile the TypeScript codebase.
2. Run qling locally or write a test script calling `CognitiveIndex.init()` and `addPractice()` repeatedly with the same `task_pattern` to verify it successfully upserts without `ON CONFLICT` exceptions.
