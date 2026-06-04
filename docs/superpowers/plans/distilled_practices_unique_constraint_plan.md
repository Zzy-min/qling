# Implementation Plan: Unique Constraint on task_pattern

## Target File
- `src/memory/cognitive-index.ts`

## Proposed Changes

### Phase 1: Modify Table Schema in `init()`
Update `distilled_practices` table definition:
```diff
       CREATE TABLE IF NOT EXISTS distilled_practices (
         id TEXT PRIMARY KEY,
-        task_pattern TEXT NOT NULL,
+        task_pattern TEXT UNIQUE NOT NULL,
         action_json TEXT NOT NULL, -- 成功执行的指令序列
```

### Phase 2: Add Migration for Existing Tables
Insert unique index creation script under the table execution block in `init()`:
```typescript
    // Ensure existing tables enforce the unique index on task_pattern
    try {
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_distilled_practices_task_pattern ON distilled_practices(task_pattern);
      `);
    } catch (err) {
      console.warn("[CognitiveIndex] Failed to create unique index, attempting deduplication:", (err as Error).message);
      try {
        this.db.exec(`
          DELETE FROM distilled_practices
          WHERE id NOT IN (
            SELECT MIN(id) FROM distilled_practices GROUP BY task_pattern
          );
        `);
        this.db.exec(`
          CREATE UNIQUE INDEX IF NOT EXISTS idx_distilled_practices_task_pattern ON distilled_practices(task_pattern);
        `);
      } catch (dedupErr) {
        console.error("[CognitiveIndex] Deduplication and index migration failed:", (dedupErr as Error).message);
      }
    }
```

## Verification Steps
1. Perform compile step: `npm run build`
2. Run test script that initializes the database, inserts two practices with the same `task_pattern`, and verifies the second entry triggers upsert (updating hit count and confidence) instead of crashing with `ON CONFLICT` error.
