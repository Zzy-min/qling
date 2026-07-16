import test from "node:test";
import assert from "node:assert/strict";

import {
  classifySessionFleetState,
  formatResumeCommand,
  relativeAge,
  sortSessionFleet,
  fleetStatePriority,
  FLEET_STALE_MS,
} from "../../dist/tui/session-fleet.js";

const NOW = Date.parse("2026-07-16T12:00:00.000Z");

test("classifySessionFleetState: active > idle > stale", () => {
  assert.equal(
    classifySessionFleetState(
      { active: true, updatedAt: "2020-01-01T00:00:00.000Z" },
      NOW
    ),
    "active"
  );
  assert.equal(
    classifySessionFleetState(
      { active: false, updatedAt: new Date(NOW - 60 * 60 * 1000).toISOString() },
      NOW
    ),
    "idle"
  );
  assert.equal(
    classifySessionFleetState(
      {
        active: false,
        updatedAt: new Date(NOW - FLEET_STALE_MS - 1000).toISOString(),
      },
      NOW
    ),
    "stale"
  );
});

test("sortSessionFleet orders by state priority then updatedAt", () => {
  const rows = sortSessionFleet(
    [
      {
        sessionId: "old",
        name: "陈旧",
        updatedAt: new Date(NOW - FLEET_STALE_MS * 2).toISOString(),
        turnCount: 1,
        messageCount: 1,
      },
      {
        sessionId: "idle-new",
        name: "近期",
        updatedAt: new Date(NOW - 10 * 60 * 1000).toISOString(),
        turnCount: 2,
        messageCount: 2,
      },
      {
        sessionId: "cur",
        name: "当前",
        updatedAt: new Date(NOW - 5 * 60 * 1000).toISOString(),
        turnCount: 3,
        messageCount: 3,
        active: true,
      },
    ],
    NOW
  );
  assert.equal(rows[0].sessionId, "cur");
  assert.equal(rows[0].state, "active");
  assert.equal(rows[1].sessionId, "idle-new");
  assert.equal(rows[1].state, "idle");
  assert.equal(rows[2].sessionId, "old");
  assert.equal(rows[2].state, "stale");
  assert.ok(fleetStatePriority("active") > fleetStatePriority("idle"));
  assert.match(rows[0].primaryLabel, /●/);
  assert.match(rows[1].primaryLabel, /○/);
  assert.match(rows[2].primaryLabel, /·/);
  assert.match(rows[0].secondaryLine, /t ·/);
});

test("relativeAge formats compact labels", () => {
  assert.equal(relativeAge(new Date(NOW - 30 * 1000).toISOString(), NOW), "30s");
  assert.equal(relativeAge(new Date(NOW - 5 * 60 * 1000).toISOString(), NOW), "5m");
  assert.equal(relativeAge(new Date(NOW - 3 * 60 * 60 * 1000).toISOString(), NOW), "3h");
  assert.equal(relativeAge(new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(), NOW), "3d");
});

test("formatResumeCommand builds deep link", () => {
  assert.equal(formatResumeCommand("abc-123"), "qling --resume abc-123");
  assert.equal(formatResumeCommand("has space"), 'qling --resume "has space"');
  assert.equal(formatResumeCommand(""), "qling --resume <session-id>");
});
