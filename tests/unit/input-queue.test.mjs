import test from "node:test";
import assert from "node:assert/strict";

import { SerialInputQueue } from "../../dist/tui/input-queue.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("serial input queue processes async entries in submit order without overlap", async () => {
  const queue = new SerialInputQueue();
  const firstGate = deferred();
  const seen = [];
  let active = 0;
  let maxActive = 0;

  const first = queue.enqueue("first", async (input) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    seen.push(`start:${input}`);
    await firstGate.promise;
    seen.push(`end:${input}`);
    active -= 1;
  });

  const second = queue.enqueue("second", async (input) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    seen.push(`start:${input}`);
    seen.push(`end:${input}`);
    active -= 1;
  });

  assert.equal(queue.isProcessing, true);
  assert.equal(queue.pendingCount, 1);
  await Promise.resolve();
  assert.deepEqual(seen, ["start:first"]);

  firstGate.resolve();
  await Promise.all([first, second]);

  assert.equal(maxActive, 1);
  assert.deepEqual(seen, ["start:first", "end:first", "start:second", "end:second"]);
  assert.equal(queue.isProcessing, false);
  assert.equal(queue.pendingCount, 0);
});

test("serial input queue reports item errors and continues draining", async () => {
  const errors = [];
  const queue = new SerialInputQueue({
    onError: (error, input) => {
      errors.push({ error, input });
    },
  });
  const seen = [];

  await Promise.all([
    queue.enqueue("bad", async (input) => {
      seen.push(input);
      throw new Error("boom");
    }),
    queue.enqueue("good", async (input) => {
      seen.push(input);
    }),
  ]);

  assert.deepEqual(seen, ["bad", "good"]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].input, "bad");
  assert.match(String(errors[0].error), /boom/);
  assert.equal(queue.isProcessing, false);
  assert.equal(queue.pendingCount, 0);
});

test("serial input queue notifies only when input is queued behind active work", async () => {
  const firstGate = deferred();
  const notifications = [];
  const queue = new SerialInputQueue({
    onQueued: ({ pendingCount }) => {
      notifications.push({ pendingCount });
    },
  });

  const first = queue.enqueue("private first prompt", async () => {
    await firstGate.promise;
  });
  const second = queue.enqueue("private second prompt", async () => {});
  const third = queue.enqueue("private third prompt", async () => {});

  assert.deepEqual(notifications, [{ pendingCount: 1 }, { pendingCount: 2 }]);

  firstGate.resolve();
  await Promise.all([first, second, third]);
  assert.equal(queue.pendingCount, 0);
});

test("serial input queue rejects new input when max pending entries is reached", async () => {
  const firstGate = deferred();
  const rejected = [];
  const seen = [];
  const queue = new SerialInputQueue({
    maxPending: 1,
    onRejected: (event) => {
      rejected.push(event);
    },
  });

  const first = queue.enqueue("active private prompt", async (input) => {
    seen.push(input);
    await firstGate.promise;
  });
  const acceptedPromise = queue.enqueue("queued private prompt", async (input) => {
    seen.push(input);
  });
  const refusedPromise = queue.enqueue("rejected private prompt", async (input) => {
    seen.push(input);
  });

  await Promise.resolve();
  assert.deepEqual(rejected, [{ pendingCount: 1, maxPending: 1 }]);
  assert.equal(Object.hasOwn(rejected[0], "input"), false);

  firstGate.resolve();
  const [accepted, refused] = await Promise.all([acceptedPromise, refusedPromise, first.then(() => true)]);
  assert.equal(accepted, true);
  assert.equal(refused, false);
  assert.deepEqual(seen, ["active private prompt", "queued private prompt"]);
  assert.equal(queue.pendingCount, 0);
});

test("serial input queue exposes max pending count without exposing inputs", () => {
  const queue = new SerialInputQueue({ maxPending: 20 });

  assert.equal(queue.maxPendingCount, 20);
  assert.equal(Object.hasOwn(queue, "input"), false);
});

test("serial input queue clears pending entries without canceling active input", async () => {
  const firstGate = deferred();
  const seen = [];
  const queue = new SerialInputQueue();

  const first = queue.enqueue("active private prompt", async (input) => {
    seen.push(input);
    await firstGate.promise;
  });
  const second = queue.enqueue("queued private prompt", async (input) => {
    seen.push(input);
  });
  const third = queue.enqueue("another queued private prompt", async (input) => {
    seen.push(input);
  });

  await Promise.resolve();
  assert.equal(queue.pendingCount, 2);

  const cleared = queue.clearPending();

  assert.equal(cleared, 2);
  assert.equal(queue.pendingCount, 0);

  firstGate.resolve();
  const [firstAccepted, secondAccepted, thirdAccepted] = await Promise.all([first, second, third]);

  assert.equal(firstAccepted, true);
  assert.equal(secondAccepted, false);
  assert.equal(thirdAccepted, false);
  assert.deepEqual(seen, ["active private prompt"]);
});
