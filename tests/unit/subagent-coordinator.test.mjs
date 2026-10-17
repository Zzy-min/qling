import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SubagentCoordinator, shouldDelegateTask } from "../../dist/agents/coordinator.js";
import { SubagentWorktreeManager } from "../../dist/agents/worktree-manager.js";
import { assertOwnedMutationPath, isRelativePathOwned, normalizeOwnedPaths } from "../../dist/agents/ownership.js";

function spec(id, overrides = {}) {
  return {
    id,
    objective: `task ${id}`,
    returnContract: "summary evidence risks",
    role: "implement",
    readOnly: false,
    ownedPaths: [`src/${id}`],
    workspaceMode: "worktree",
    budget: { wallClockMs: 60_000, tokens: 10_000, toolCalls: 20 },
    allowedCommunication: ["manager"],
    cancellation: "cascade",
    acceptance: ["tests pass"],
    ...overrides,
  };
}

test("coordinator rejects overlapping write ownership and allows read-only exploration", () => {
  const coordinator = new SubagentCoordinator();
  coordinator.register(spec("one", { ownedPaths: ["src/runtime"] }));
  assert.throws(
    () => coordinator.register(spec("two", { ownedPaths: ["src/runtime/session.ts"] })),
    /ownership conflict/i
  );
  assert.doesNotThrow(() => coordinator.register(spec("reader", {
    role: "explore",
    readOnly: true,
    ownedPaths: [],
    workspaceMode: "shared_readonly",
  })));
});

test("coordinator enforces mailbox permissions and cascades cancellation", () => {
  const coordinator = new SubagentCoordinator();
  coordinator.register(spec("parent", { allowedCommunication: ["child"] }));
  coordinator.register(spec("child", { parentTaskId: "parent", allowedCommunication: ["parent"] }));
  coordinator.start("parent");
  coordinator.start("child");
  coordinator.sendMessage("parent", "child", "check this file");
  assert.equal(coordinator.readMailbox("child")[0].message, "check this file");
  assert.throws(() => coordinator.sendMessage("child", "manager", "not allowed"), /not allowed/i);
  coordinator.cancel("parent", "user canceled");
  assert.equal(coordinator.get("child").status, "canceled");
});

test("delegation gate requires independence and expected new information", () => {
  assert.equal(shouldDelegateTask({ independent: true, expectedNewInformation: true, estimatedBenefit: 8, coordinationCost: 3 }), true);
  assert.equal(shouldDelegateTask({ independent: false, expectedNewInformation: true, estimatedBenefit: 8, coordinationCost: 3 }), false);
  assert.equal(shouldDelegateTask({ independent: true, expectedNewInformation: false, estimatedBenefit: 8, coordinationCost: 3 }), false);
});

test("worktree manager creates a scoped branch and target without deleting it", async () => {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-worktree-manager-"));
  const calls = [];
  const manager = new SubagentWorktreeManager({
    stateDir,
    executeGit: async (args, cwd) => {
      calls.push({ args, cwd });
      if (args[0] === "rev-parse") return { stdout: "C:/repo\n" };
      return { stdout: "" };
    },
  });
  const result = await manager.create({ taskId: "task:one", workspaceDir: "C:/repo" });
  assert.equal(result.branch, "qling-agent/task-one");
  assert.equal(path.resolve(result.path).startsWith(path.resolve(stateDir)), true);
  assert.deepEqual(calls[1].args.slice(0, 3), ["worktree", "add", "-b"]);
  assert.equal(calls.some((call) => call.args.includes("remove")), false);
});

test("owned paths reject traversal and enforce the declared subtree", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-owned-"));
  try {
    assert.throws(() => normalizeOwnedPaths(["../parent"]), /workspace-relative/);
    assert.equal(isRelativePathOwned("src/runtime/a.ts", ["src/runtime"]), true);
    assert.equal(isRelativePathOwned("package.json", ["src/runtime"]), false);
    await assertOwnedMutationPath({ workspaceDir: dir, target: "src/runtime/a.ts", ownedPaths: ["src/runtime"] });
    await assert.rejects(() => assertOwnedMutationPath({ workspaceDir: dir, target: "package.json", ownedPaths: ["src/runtime"] }), /outside owned_paths/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("owned paths reject a symlink or junction that resolves outside the owned subtree", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qling-owned-link-"));
  try {
    const owned = path.join(dir, "owned");
    const outside = path.join(dir, "outside");
    await fs.mkdir(owned, { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.symlink(outside, path.join(owned, "link"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      () => assertOwnedMutationPath({ workspaceDir: dir, target: "owned/link/escape.txt", ownedPaths: ["owned"] }),
      /escapes owned_paths/
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
