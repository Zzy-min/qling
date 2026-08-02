import assert from "node:assert/strict";
import { SubagentCoordinator } from "../dist/agents/coordinator.js";

const coordinator = new SubagentCoordinator();
const spec = (id, ownedPaths) => ({ id, objective: id, returnContract: "evidence", role: "implement", readOnly: false, ownedPaths, workspaceMode: "worktree", budget: { wallClockMs: 1000, tokens: 1000, toolCalls: 10 }, allowedCommunication: [], cancellation: "cascade", acceptance: ["tests"] });
coordinator.register(spec("writer-a", ["src/runtime"]));
assert.throws(() => coordinator.register(spec("writer-b", ["src/runtime/types.ts"])), /ownership conflict/);
coordinator.complete("writer-a");
coordinator.register(spec("writer-b", ["src/runtime/types.ts"]));
assert.equal(coordinator.list().length, 2);
console.log(JSON.stringify({ eval: "multi-agent", passed: 2, conflicts: 1 }));
