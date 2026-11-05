import test from "node:test";
import assert from "node:assert/strict";
import { runBoundedToolBatch } from "../../dist/tools/scheduler.js";

const read = (id) => ({ value: id, readOnly: true, concurrencySafe: true, sideEffect: "none" });
const write = (id) => ({ value: id, readOnly: false, concurrencySafe: false, sideEffect: "workspace" });

test("bounded scheduler parallelizes read-only calls and serializes writes as barriers", async () => {
  const events = [];
  const active = new Set();
  let maxParallel = 0;

  const results = await runBoundedToolBatch(
    [read("r1"), read("r2"), write("w1"), read("r3"), read("r4")],
    async (id) => {
      events.push(`start:${id}`);
      active.add(id);
      maxParallel = Math.max(maxParallel, active.size);
      await new Promise((resolve) => setTimeout(resolve, id.startsWith("r") ? 20 : 5));
      active.delete(id);
      events.push(`end:${id}`);
      return id;
    },
    { limit: 2 }
  );

  assert.deepEqual(results, ["r1", "r2", "w1", "r3", "r4"]);
  assert.ok(maxParallel >= 2, "independent reads should overlap");
  assert.ok(events.indexOf("end:r1") < events.indexOf("start:w1"), "write waits for read barrier");
  assert.ok(events.indexOf("end:w1") < events.indexOf("start:r3"), "read after write waits for barrier");
});
