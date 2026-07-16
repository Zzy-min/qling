import test from "node:test";
import assert from "node:assert/strict";

import { dashboardCommand, resolveDashboardSurface } from "../../dist/commands/dashboard.js";

test("resolveDashboardSurface defaults to tui fleet", () => {
  assert.equal(resolveDashboardSurface([]), "tui");
  assert.equal(resolveDashboardSurface(["tui"]), "tui");
  assert.equal(resolveDashboardSurface(["fleet"]), "tui");
  assert.equal(resolveDashboardSurface(["sessions"]), "tui");
  assert.equal(resolveDashboardSurface(["web"]), "web");
  assert.equal(resolveDashboardSurface(["url"]), "web");
  assert.equal(resolveDashboardSurface(["open"]), "web");
  assert.equal(resolveDashboardSurface(["mc"]), "web");
});

test("dashboardCommand bare opens session picker when available", async () => {
  let opened = false;
  const lines = [];
  await dashboardCommand.execute([], {
    writeLine: (l) => lines.push(l),
    openSessionPicker: () => {
      opened = true;
    },
  });
  assert.equal(opened, true);
  assert.equal(lines.length, 0);
});

test("dashboardCommand web prints mission control block", async () => {
  const lines = [];
  await dashboardCommand.execute(["web"], {
    writeLine: (l) => lines.push(l),
    openSessionPicker: () => {
      throw new Error("should not open fleet for web");
    },
  });
  const text = lines.join("\n");
  assert.match(text, /Mission Control|任务工作台/);
  assert.match(text, /127\.0\.0\.1|dashboard start|未开启/);
});

test("dashboardCommand tui without picker falls back to hints", async () => {
  const lines = [];
  await dashboardCommand.execute(["tui"], {
    writeLine: (l) => lines.push(l),
  });
  const text = lines.join("\n");
  assert.match(text, /不可用|sessions list|dashboard web/);
});
