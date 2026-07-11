import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyCommand } from "../../dist/commands/verify.js";

test("/verify command status/set/clear/run", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-verify-test-"));
  try {
    let mockCommand = null;
    const outputs = [];
    const errors = [];

    const mockAgentLoop = {
      getVerificationCommand: () => mockCommand,
      setVerificationCommand: async (cmd) => {
        mockCommand = cmd;
      },
      runVerificationCommand: async (cmd) => {
        if (cmd === "pass") {
          return { code: 0, stdout: "Passed stdout", stderr: "" };
        } else {
          return { code: 1, stdout: "Failed stdout", stderr: "Failed stderr" };
        }
      },
      getWorkspaceDir: () => dir,
    };

    const context = {
      agentLoop: mockAgentLoop,
      workspaceDir: dir,
      writeLine: (msg) => outputs.push(msg),
      writeError: (msg) => errors.push(msg),
    };

    // 1. Status - Not set
    await verifyCommand.execute(["status"], context);
    let joinedOut = outputs.join("\n");
    assert.match(joinedOut, /当前验证命令 : \(未设置\)/);
    assert.match(joinedOut, /自动恢复状态 : 已关闭/);
    outputs.length = 0;

    // 2. Set command
    await verifyCommand.execute(["set", "npm run build"], context);
    assert.equal(mockCommand, "npm run build");
    assert.match(outputs.join("\n"), /自动验证命令设置成功: "npm run build"/);
    outputs.length = 0;

    // 3. Status - Set
    await verifyCommand.execute(["status"], context);
    joinedOut = outputs.join("\n");
    assert.match(joinedOut, /当前验证命令 : npm run build/);
    assert.match(joinedOut, /自动恢复状态 : 已开启/);
    assert.match(joinedOut, /同因最多 2 次，策略预算 4 次/);
    outputs.length = 0;

    // 4. Run passing verification
    mockCommand = "pass";
    await verifyCommand.execute(["run"], context);
    joinedOut = outputs.join("\n");
    assert.match(joinedOut, /Passed stdout/);
    assert.match(joinedOut, /验证通过/);
    outputs.length = 0;

    // 5. Run failing verification
    mockCommand = "fail";
    await verifyCommand.execute(["run"], context);
    assert.match(errors.join("\n"), /验证失败/);
    errors.length = 0;

    // 6. Clear command
    await verifyCommand.execute(["clear"], context);
    assert.equal(mockCommand, null);
    assert.match(outputs.join("\n"), /自动验证命令已清除/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
