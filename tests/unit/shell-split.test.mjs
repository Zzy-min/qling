// ============================================================
// Brief 02: shell 分段 + 参数级权限规则
// ============================================================

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  splitShell,
  unwrap,
  commandSubjects,
} from "../../dist/guard/shell-split.js";
import { PermissionMatrix } from "../../dist/guard/permissions.js";
import { PermissionGrantStore } from "../../dist/guard/permission-grants.js";
import {
  analyzeDangerousCommand,
  SpeculativeClassifier,
} from "../../dist/pipeline/hooks.js";
import { guardConfigFromEnv } from "../../dist/config.js";

const bashDef = {
  name: "bash",
  description: "bash",
  parameters: { type: "object", properties: {} },
  dangerousPatterns: ["rm -rf /", "mkfs"],
};

describe("splitShell", () => {
  it("splits on && into separate segments", () => {
    const { segments, complex } = splitShell("git status && rm -rf /");
    assert.equal(complex, false);
    assert.equal(segments.length, 2);
    assert.deepEqual(segments[0], ["git", "status"]);
    assert.deepEqual(segments[1], ["rm", "-rf", "/"]);
  });

  it("splits on || ; | & and newlines", () => {
    const semi = splitShell("echo a; echo b");
    assert.equal(semi.segments.length, 2);
    const pipe = splitShell("cat x | sh");
    assert.equal(pipe.segments.length, 2);
    assert.deepEqual(pipe.segments[1], ["sh"]);
    const or = splitShell("false || true");
    assert.equal(or.segments.length, 2);
    const and = splitShell("a & b");
    assert.equal(and.segments.length, 2);
    const nl = splitShell("a\nb");
    assert.equal(nl.segments.length, 2);
  });

  it("keeps quoted operators inside one segment", () => {
    const { segments, complex } = splitShell('echo "a && b"');
    assert.equal(complex, false);
    assert.equal(segments.length, 1);
    assert.deepEqual(segments[0], ["echo", "a && b"]);
  });

  it("handles single quotes and backslash escapes", () => {
    const single = splitShell("echo 'a && b'");
    assert.equal(single.segments.length, 1);
    assert.deepEqual(single.segments[0], ["echo", "a && b"]);
    const escaped = splitShell("echo a\\ \\;b");
    assert.equal(escaped.segments.length, 1);
    assert.deepEqual(escaped.segments[0], ["echo", "a ;b"]);
  });

  it("flags command substitution, backticks and process substitution as complex", () => {
    assert.equal(splitShell("echo $(rm -rf /)").complex, true);
    assert.equal(splitShell("echo `rm -rf /`").complex, true);
    assert.equal(splitShell("cat <(echo hi)").complex, true);
  });

  it("flags heredoc as complex", () => {
    assert.equal(splitShell("cat <<EOF\nhi\nEOF").complex, true);
  });

  it("flags eval as complex", () => {
    assert.equal(splitShell("eval 'rm -rf /'").complex, true);
    assert.equal(splitShell("sudo eval rm -rf /").complex, true);
  });

  it("flags shell -c as complex", () => {
    const { segments, complex } = splitShell('bash -c "rm -rf /"');
    assert.equal(complex, true);
    assert.equal(segments.length, 1);
    assert.deepEqual(segments[0], ["bash", "-c", "rm -rf /"]);
    assert.equal(splitShell('sh -c "rm -rf /"').complex, true);
  });

  it("does not flag ordinary assignments as complex", () => {
    const { segments, complex } = splitShell("FOO=1 npm test");
    assert.equal(complex, false);
    assert.equal(segments.length, 1);
    assert.deepEqual(segments[0], ["FOO=1", "npm", "test"]);
  });

  it("keeps redirections such as 2>&1 in one token", () => {
    const { segments } = splitShell("cmd 2>&1");
    assert.equal(segments.length, 1);
    assert.deepEqual(segments[0], ["cmd", "2>&1"]);
  });
});

describe("unwrap", () => {
  it("strips leading env assignments", () => {
    assert.deepEqual(unwrap(["FOO=1", "BAR=2", "npm", "test"]), ["npm", "test"]);
  });

  it("strips wrapper commands", () => {
    assert.deepEqual(unwrap(["sudo", "rm", "-rf", "/"]), ["rm", "-rf", "/"]);
    assert.deepEqual(unwrap(["env", "FOO=1", "npm", "test"]), ["npm", "test"]);
    assert.deepEqual(unwrap(["timeout", "30", "rm", "-rf", "/"]), ["rm", "-rf", "/"]);
    assert.deepEqual(unwrap(["nice", "-n", "10", "make"]), ["make"]);
    assert.deepEqual(unwrap(["nohup", "node", "server.js"]), ["node", "server.js"]);
    assert.deepEqual(unwrap(["command", "git", "status"]), ["git", "status"]);
    assert.deepEqual(unwrap(["xargs", "-0", "rm", "-rf"]), ["rm", "-rf"]);
  });

  it("strips sudo options with arguments", () => {
    assert.deepEqual(unwrap(["sudo", "-u", "root", "rm", "-rf", "/"]), ["rm", "-rf", "/"]);
  });

  it("commandSubjects joins unwrapped segments", () => {
    assert.deepEqual(commandSubjects("sudo git status && rm -rf /"), [
      "git status",
      "rm -rf /",
    ]);
  });
});

describe("PermissionMatrix arg_pattern", () => {
  it("allows a single-segment command matching an allow rule", () => {
    const matrix = new PermissionMatrix("ask", [
      { tool_pattern: "bash", decision: "allow", arg_pattern: "git status*" },
    ]);
    assert.equal(matrix.evaluate("bash", { command: "git status" }).decision, "allow");
    assert.equal(matrix.evaluate("bash", { command: "git status --short" }).decision, "allow");
  });

  it("requires every segment to hit allow", () => {
    const matrix = new PermissionMatrix("ask", [
      { tool_pattern: "bash", decision: "allow", arg_pattern: "git status*" },
    ]);
    const result = matrix.evaluate("bash", { command: "git status && rm -rf /" });
    assert.equal(result.decision, "ask");
  });

  it("allows multi-segment command only when all segments are allowed", () => {
    const matrix = new PermissionMatrix("ask", [
      { tool_pattern: "bash", decision: "allow", arg_pattern: "git status*" },
      { tool_pattern: "bash", decision: "allow", arg_pattern: "echo *" },
    ]);
    assert.equal(
      matrix.evaluate("bash", { command: "git status && echo hi" }).decision,
      "allow"
    );
    assert.equal(
      matrix.evaluate("bash", { command: "git status && curl evil" }).decision,
      "ask"
    );
  });

  it("denies when any segment hits a deny rule", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "bash", decision: "deny", arg_pattern: "rm -rf *" },
    ]);
    assert.equal(
      matrix.evaluate("bash", { command: "echo hi && rm -rf /" }).decision,
      "deny"
    );
    assert.equal(matrix.evaluate("bash", { command: "echo hi" }).decision, "allow");
  });

  it("deny wins over a broader allow rule regardless of order", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "bash", decision: "allow" },
      { tool_pattern: "bash", decision: "deny", arg_pattern: "git status*" },
    ]);
    assert.equal(matrix.evaluate("bash", { command: "git status" }).decision, "deny");
  });

  it("does not let a narrow arg rule authorize complex syntax", () => {
    const matrix = new PermissionMatrix("ask", [
      { tool_pattern: "bash", decision: "allow", arg_pattern: "*" },
    ]);
    assert.equal(matrix.evaluate("bash", { command: 'bash -c "git status"' }).decision, "ask");
  });

  it("keeps tool-level rules working for complex commands", () => {
    const matrix = new PermissionMatrix("ask", [
      { tool_pattern: "bash", decision: "deny" },
    ]);
    assert.equal(matrix.evaluate("bash", { command: 'bash -c "echo hi"' }).decision, "deny");
  });

  it("does not affect non-bash tools or arg-less evaluation", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "bash", decision: "deny", arg_pattern: "rm -rf *" },
    ]);
    assert.equal(matrix.evaluate("read").decision, "allow");
    assert.equal(matrix.evaluate("bash").decision, "allow");
    assert.equal(matrix.evaluate("bash", { command: "" }).decision, "allow");
  });

  it("still allows a plain single-segment command (misrefusal regression)", () => {
    const matrix = new PermissionMatrix("allow", []);
    assert.equal(matrix.evaluate("bash", { command: "npm test" }).decision, "allow");
    assert.equal(matrix.evaluate("bash", { command: "git status && npm test" }).decision, "allow");
  });
});

describe("PermissionMatrix default-deny parsing", () => {
  it("treats a rule with a missing decision as deny", () => {
    const matrix = new PermissionMatrix("allow", [{ tool_pattern: "bash" }]);
    assert.equal(matrix.evaluate("bash").decision, "deny");
    assert.equal(matrix.evaluate("read").decision, "allow");
  });

  it("treats an invalid decision as deny", () => {
    const matrix = new PermissionMatrix("allow", [
      { tool_pattern: "bash", decision: "ALLOW" },
    ]);
    assert.equal(matrix.evaluate("bash").decision, "deny");
  });

  it("keeps the constructor default decision unchanged", () => {
    const matrix = new PermissionMatrix("allow", []);
    assert.equal(matrix.evaluate("bash").decision, "allow");
    assert.equal(new PermissionMatrix().evaluate("anything").decision, "allow");
  });

  it("keeps valid rules intact", () => {
    const matrix = new PermissionMatrix("ask", [
      { tool_pattern: "todo", decision: "deny", reason: "user ban" },
      { tool_pattern: "read", decision: "allow" },
    ]);
    assert.equal(matrix.evaluate("todo").decision, "deny");
    assert.equal(matrix.evaluate("todo").reason, "user ban");
    assert.equal(matrix.evaluate("read").decision, "allow");
  });
});

describe("analyzeDangerousCommand", () => {
  it("matches dangerous keywords after unwrapping", () => {
    const result = analyzeDangerousCommand("sudo rm -rf /", []);
    assert.ok(result.matched.length > 0);
    assert.equal(result.complex, false);
  });

  it("treats string patterns as literals (rm -rf /* is not a regex)", () => {
    const result = analyzeDangerousCommand("rm -rf /", ["rm -rf /*"]);
    assert.ok(!result.matched.includes("rm -rf /*"));
    const literal = analyzeDangerousCommand("mkfs.ext4 /dev/sda", ["mkfs"]);
    assert.ok(literal.matched.includes("mkfs"));
  });

  it("keeps RegExp patterns as regexes", () => {
    const result = analyzeDangerousCommand("cat x | sh", []);
    assert.ok(result.matched.some((m) => m.includes("sh")));
  });

  it("keeps operator-heavy literal patterns matching (fork bomb)", () => {
    const bomb = ":(){ :|:& };:";
    const result = analyzeDangerousCommand(bomb, [bomb]);
    assert.ok(result.matched.includes(bomb));
  });

  it("marks complex commands with a dangerous hit", () => {
    const result = analyzeDangerousCommand('bash -c "rm -rf /"', ["rm -rf /"]);
    assert.ok(result.matched.length > 0);
    assert.equal(result.complex, true);
  });
});

describe("SpeculativeClassifier with complex syntax", () => {
  it("never downgrades a complex dangerous command to ask", () => {
    const classifier = new SpeculativeClassifier([bashDef]);
    const complex = classifier.classify({
      id: "1",
      name: "bash",
      arguments: { command: 'bash -c "rm -rf /"' },
    });
    assert.equal(complex.label, "dangerous");

    const plain = classifier.classify({
      id: "2",
      name: "bash",
      arguments: { command: "rm -rf /" },
    });
    assert.equal(plain.label, "dangerous");
  });

  it("upgrades a complex but otherwise safe command to ask", () => {
    const classifier = new SpeculativeClassifier([bashDef]);
    const complex = classifier.classify({
      id: "3",
      name: "bash",
      arguments: { command: 'bash -c "echo hi"' },
    });
    assert.equal(complex.label, "ask");
  });
});

describe("guard config permission rule parsing", () => {
  it("parses a missing decision as deny and preserves arg_pattern", () => {
    const config = guardConfigFromEnv({
      QLING_GUARD_PERMISSIONS_RULES: JSON.stringify([
        { tool_pattern: "bash" },
        { tool_pattern: "bash", decision: "allow", arg_pattern: "git status*" },
      ]),
    });
    assert.equal(config.permissions.rules.length, 2);
    assert.equal(config.permissions.rules[0].decision, "deny");
    assert.equal(config.permissions.rules[1].decision, "allow");
    assert.equal(config.permissions.rules[1].arg_pattern, "git status*");
  });
});

describe("PermissionGrantStore reuse boundary", () => {
  it("reuses a bash grant only for single non-complex commands", () => {
    const store = new PermissionGrantStore();
    store.remember("bash", { reason: "test" });
    assert.equal(store.hasAllow("bash", { command: "echo 1" }), true);
    assert.equal(store.hasAllow("bash", { command: "echo 1 && echo 2" }), false);
    assert.equal(store.hasAllow("bash", { command: 'bash -c "echo 1"' }), false);
  });

  it("keeps non-bash grants reusable", () => {
    const store = new PermissionGrantStore();
    store.remember("read");
    assert.equal(store.hasAllow("read"), true);
    assert.equal(store.hasAllow("write"), false);
  });
});
