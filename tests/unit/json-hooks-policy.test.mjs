import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonHookRunner, encodeHookPayload, installJsonHooks, jsonHooksMaxPayloadBytes, resetJsonHookMatcherWarningsForTests } from "../../dist/hooks/json-hooks.js";
import { disableHook, enableHook, readDisabledHookNames } from "../../dist/hooks/disabled-hooks.js";
import { HookManager } from "../../dist/pipeline/hooks.js";

function ctx(toolName, args = {}) {
  return {
    toolName,
    arguments: args,
    inputSchema: {},
    isReadOnly: toolName === "read",
    isDestructive: false,
    isConcurrencySafe: true,
    dangerousPatterns: [],
  };
}

function guard(rules = []) {
  return {
    enabled: false,
    network: { url_fetch: { allowed_url_prefixes: [], deny_private_ips: true, follow_redirects: false } },
    redaction: { enabled: false, patterns: [] },
    audit: { jsonl_path: "" },
    rate_limit: { enabled: false, max_per_minute: 0 },
    content_filter: { enabled: false, pii_detection: false, injection_detection: false, custom_patterns: [] },
    permissions: { default: "allow", rules },
  };
}

const tools = [
  { name: "read", description: "read", parameters: {}, readOnly: true },
  { name: "write", description: "write", parameters: {}, readOnly: false },
  { name: "bash", description: "bash", parameters: {} },
];

async function runnerFor(dir, events, extra = {}) {
  return new JsonHookRunner({ events }, {
    workspaceDir: dir,
    auditPath: join(dir, "audit", "events.jsonl"),
    timeoutMs: extra.timeoutMs ?? 3000,
    maxOutputBytes: extra.maxOutputBytes ?? 64 * 1024,
    disabledNames: extra.disabledNames,
    maxPayloadBytes: extra.maxPayloadBytes,
    knownToolNames: extra.knownToolNames,
  });
}

test("PreToolUse stays fail-closed when a hook exits non-zero, times out, or returns invalid JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-closed-"));
  try {
    const exitScript = join(dir, "exit.mjs");
    const badJson = join(dir, "bad.mjs");
    const hang = join(dir, "hang.mjs");
    await writeFile(exitScript, "process.stdin.resume(); process.stdin.on('end', () => process.exit(2));\n");
    await writeFile(badJson, "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('nope'));\n");
    await writeFile(hang, "process.stdin.resume(); setInterval(() => {}, 1000);\n");
    const exited = await runnerFor(dir, { PreToolUse: [{ command: process.execPath, args: [exitScript] }] });
    const invalid = await runnerFor(dir, { PreToolUse: [{ command: process.execPath, args: [badJson] }] });
    const timed = await runnerFor(dir, { PreToolUse: [{ command: process.execPath, args: [hang], timeoutMs: 200 }] });
    assert.equal((await exited.runPre(ctx("bash"))).decision, "ask");
    assert.equal((await invalid.runPre(ctx("bash"))).decision, "ask");
    assert.equal((await timed.runPre(ctx("bash"))).decision, "ask");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PreToolUse matcher compile failure fails closed instead of allowing the tool", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-matcher-"));
  try {
    const denyLog = join(dir, "deny.txt");
    const deny = join(dir, "deny.mjs");
    await writeFile(deny, `import { appendFileSync } from "node:fs"; process.stdin.resume(); process.stdin.on("end", () => { appendFileSync(${JSON.stringify(denyLog)}, "x\\n"); console.log(JSON.stringify({ decision: "deny", blockingError: "hook deny" })); });\n`);
    const broken = await runnerFor(dir, {
      PreToolUse: [{ name: "guard", matcher: "(", command: process.execPath, args: [deny] }],
    });
    const blocked = await broken.runPre(ctx("bash"));
    assert.notEqual(blocked.decision, "allow");
    assert.equal(blocked.decision, "ask");
    assert.match(blocked.additionalContexts.join("\n"), /matcher failed to compile/);
    await assert.rejects(readFile(denyLog, "utf8"));
    const audit = await readFile(join(dir, "audit", "events.jsonl"), "utf8");
    assert.match(audit, /PreToolUse/);
    assert.match(audit, /matcher_compile_failed/);

    const explicitOff = await runnerFor(join(dir, "off"), {
      PreToolUse: [{ name: "guard", matcher: "(", enabled: false, command: process.execPath, args: [deny] }],
    });
    assert.equal((await explicitOff.runPre(ctx("bash"))).decision, "allow");
    const namedOff = await runnerFor(dir, {
      PreToolUse: [{ name: "guard", matcher: "(", command: process.execPath, args: [deny] }],
    }, { disabledNames: new Set(["guard"]) });
    assert.equal((await namedOff.runPre(ctx("read"))).decision, "allow");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PreToolUse merges decisions by strictest rank and keeps a prior deny", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-strict-"));
  try {
    const deny = join(dir, "deny.mjs");
    const allow = join(dir, "allow.mjs");
    await writeFile(deny, "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ decision: 'deny', blockingError: 'hook deny' })));\n");
    await writeFile(allow, "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ decision: 'allow' })));\n");
    const denyThenBroken = await runnerFor(dir, {
      PreToolUse: [
        { name: "deny-first", command: process.execPath, args: [deny] },
        { name: "broken", matcher: "(", command: process.execPath, args: [allow] },
      ],
    });
    const first = await denyThenBroken.runPre(ctx("bash"));
    assert.equal(first.decision, "deny");
    assert.match(first.blockingError, /hook deny/);
    const brokenThenDeny = await runnerFor(dir, {
      PreToolUse: [
        { name: "broken-first", matcher: "[", command: process.execPath, args: [allow] },
        { name: "deny-second", command: process.execPath, args: [deny] },
      ],
    });
    assert.equal((await brokenThenDeny.runPre(ctx("bash"))).decision, "deny");
    const brokenThenAllow = await runnerFor(dir, {
      PreToolUse: [
        { name: "broken-only", matcher: "(", command: process.execPath, args: [deny] },
        { name: "allow-later", command: process.execPath, args: [allow] },
      ],
    });
    const asked = await brokenThenAllow.runPre(ctx("bash"));
    assert.equal(asked.decision, "ask");
    assert.match(asked.additionalContexts.join("\n"), /matcher failed to compile/);
    const allowThenDeny = await runnerFor(dir, {
      PreToolUse: [
        { name: "allow-first", command: process.execPath, args: [allow] },
        { name: "deny-later", command: process.execPath, args: [deny] },
      ],
    });
    const denied = await allowThenDeny.runPre(ctx("read"));
    assert.equal(denied.decision, "deny");
    assert.match(denied.blockingError, /hook deny/);
    const audit = await readFile(join(dir, "audit", "events.jsonl"), "utf8");
    assert.match(audit, /matcher_compile_failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PreToolUse matcher without a tool name fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-noname-"));
  try {
    const log = join(dir, "ran.txt");
    const script = join(dir, "deny.mjs");
    await writeFile(script, `import { appendFileSync } from "node:fs"; process.stdin.resume(); process.stdin.on("end", () => { appendFileSync(${JSON.stringify(log)}, "x\\n"); console.log(JSON.stringify({ decision: "deny", blockingError: "hook deny" })); });\n`);
    const runner = await runnerFor(dir, {
      PreToolUse: [{ name: "needs-tool", matcher: "^bash$", command: process.execPath, args: [script] }],
    });
    const missing = await runner.runPre({ ...ctx("bash"), toolName: "   " });
    assert.notEqual(missing.decision, "allow");
    assert.equal(missing.decision, "ask");
    assert.match(missing.additionalContexts.join("\n"), /no tool name/);
    await assert.rejects(readFile(log, "utf8"));
    const audit = await readFile(join(dir, "audit", "events.jsonl"), "utf8");
    assert.match(audit, /matcher_missing_tool_name/);
    assert.equal((await runner.runPre(ctx("bash"))).decision, "deny");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PostToolUse invalid matcher disables only that entry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-post-matcher-"));
  try {
    const badLog = join(dir, "bad.txt");
    const okLog = join(dir, "ok.txt");
    const bad = join(dir, "bad.mjs");
    const ok = join(dir, "ok.mjs");
    await writeFile(bad, `import { appendFileSync } from "node:fs"; process.stdin.resume(); process.stdin.on("end", () => appendFileSync(${JSON.stringify(badLog)}, "x\\n"));\n`);
    await writeFile(ok, `import { appendFileSync } from "node:fs"; process.stdin.resume(); process.stdin.on("end", () => appendFileSync(${JSON.stringify(okLog)}, "x\\n"));\n`);
    const runner = await runnerFor(dir, {
      PostToolUse: [
        { name: "broken", matcher: "(", command: process.execPath, args: [bad] },
        { name: "observer", matcher: "^read$", command: process.execPath, args: [ok] },
      ],
    });
    await runner.runPost(ctx("read"), { tool_call_id: "1", is_error: false });
    await assert.rejects(readFile(badLog, "utf8"));
    assert.equal((await readFile(okLog, "utf8")).trim(), "x");
    const audit = await readFile(join(dir, "audit", "events.jsonl"), "utf8");
    assert.match(audit, /matcher_compile_failed/);
    assert.match(audit, /PostToolUse/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("tool matcher matches the whole name, alternation, and still fails closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-whole-matcher-"));
  try {
    const log = join(dir, "spawns.txt");
    const script = join(dir, "count.mjs");
    await writeFile(script, `import { appendFileSync } from "node:fs"; let raw = ""; process.stdin.on("data", (c) => { raw += c; }); process.stdin.on("end", () => appendFileSync(${JSON.stringify(log)}, "1\\n"));\n`);
    const editOnly = await runnerFor(dir, {
      PreToolUse: [{ name: "edit-only", matcher: "Edit", command: process.execPath, args: [script] }],
    });
    assert.equal((await editOnly.runPre(ctx("MultiEdit"))).decision, "allow");
    await assert.rejects(readFile(log, "utf8"));
    assert.equal((await editOnly.runPre(ctx("Edit"))).decision, "allow");
    assert.equal((await readFile(log, "utf8")).trim(), "1");

    const either = await runnerFor(dir, {
      PreToolUse: [{ name: "either", matcher: "Edit|Write", command: process.execPath, args: [script] }],
    });
    assert.equal((await either.runPre(ctx("Edit"))).decision, "allow");
    assert.equal((await either.runPre(ctx("Write"))).decision, "allow");
    assert.equal((await either.runPre(ctx("MultiEdit"))).decision, "allow");
    assert.equal((await readFile(log, "utf8")).trim().split(/\n/).length, 3);

    const broken = await runnerFor(dir, {
      PreToolUse: [{ name: "broken", matcher: "(", command: process.execPath, args: [script] }],
    });
    const asked = await broken.runPre(ctx("Edit"));
    assert.notEqual(asked.decision, "allow");
    assert.equal(asked.decision, "ask");
    assert.match(asked.additionalContexts.join("\n"), /matcher failed to compile/);
    assert.equal((await readFile(log, "utf8")).trim().split(/\n/).length, 3);
    const audit = await readFile(join(dir, "audit", "events.jsonl"), "utf8");
    assert.match(audit, /matcher_compile_failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("patch and read matchers also match anchored aliases but not unrelated names", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-alias-matcher-"));
  try {
    const log = join(dir, "spawns.txt");
    const script = join(dir, "deny.mjs");
    await writeFile(script, `import { appendFileSync } from "node:fs"; process.stdin.resume(); process.stdin.on("end", () => { appendFileSync(${JSON.stringify(log)}, "x\\n"); console.log(JSON.stringify({ decision: "deny", blockingError: "hook deny" })); });\n`);
    const spawns = async () => {
      try {
        return (await readFile(log, "utf8")).trim().split(/\n/).length;
      } catch {
        return 0;
      }
    };
    const patchOnly = await runnerFor(dir, {
      PreToolUse: [{ name: "patch-only", matcher: "patch", command: process.execPath, args: [script] }],
    });
    assert.equal((await patchOnly.runPre(ctx("patch"))).decision, "deny");
    assert.equal((await patchOnly.runPre(ctx("patch_anchored"))).decision, "deny");
    assert.equal((await patchOnly.runPre(ctx("write"))).decision, "allow");
    assert.equal((await patchOnly.runPre(ctx("patch_file"))).decision, "allow");
    assert.equal(await spawns(), 2);

    const readOnly = await runnerFor(dir, {
      PreToolUse: [{ name: "read-only", matcher: "read", command: process.execPath, args: [script] }],
    });
    assert.equal((await readOnly.runPre(ctx("read"))).decision, "deny");
    assert.equal((await readOnly.runPre(ctx("read_anchored"))).decision, "deny");
    assert.equal((await readOnly.runPre(ctx("read_file"))).decision, "allow");
    assert.equal(await spawns(), 4);

    const either = await runnerFor(dir, {
      PreToolUse: [{ name: "patch-or-write", matcher: "patch|write", command: process.execPath, args: [script] }],
    });
    assert.equal((await either.runPre(ctx("patch_anchored"))).decision, "deny");
    assert.equal((await either.runPre(ctx("write"))).decision, "deny");
    assert.equal((await either.runPre(ctx("read_anchored"))).decision, "allow");
    assert.equal(await spawns(), 6);

    const broken = await runnerFor(dir, {
      PreToolUse: [{ name: "broken", matcher: "(", command: process.execPath, args: [script] }],
    });
    const asked = await broken.runPre(ctx("patch_anchored"));
    assert.notEqual(asked.decision, "allow");
    assert.equal(asked.decision, "ask");
    assert.match(asked.additionalContexts.join("\n"), /matcher failed to compile/);
    assert.equal(await spawns(), 6);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("matcher compatibility warning fires once only when a substring hit is lost", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-matcher-warn-"));
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  resetJsonHookMatcherWarningsForTests();
  try {
    const script = join(dir, "allow.mjs");
    await writeFile(script, "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ decision: 'allow' })));\n");
    const alias = await runnerFor(dir, {
      PreToolUse: [{ name: "patch-alias", matcher: "patch", command: process.execPath, args: [script] }],
    }, { knownToolNames: ["patch", "patch_anchored", "read", "read_anchored"] });
    assert.equal((await alias.runPre(ctx("patch_anchored"))).decision, "allow");
    assert.equal((await alias.runPre(ctx("patch"))).decision, "allow");
    assert.deepEqual(warnings, []);

    const lost = await runnerFor(dir, {
      PreToolUse: [{ name: "read-prefix", matcher: "read", command: process.execPath, args: [script] }],
    }, { knownToolNames: ["read", "read_anchored", "read_file"] });
    assert.equal((await lost.runPre(ctx("read_anchored"))).decision, "allow");
    assert.equal((await lost.runPre(ctx("read_file"))).decision, "allow");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /"read"/);
    assert.match(warnings[0], /substring/);

    const again = await runnerFor(dir, {
      PreToolUse: [{ name: "read-prefix-again", matcher: "read", command: process.execPath, args: [script] }],
    }, { knownToolNames: ["read_file"] });
    assert.equal((await again.runPre(ctx("read"))).decision, "allow");
    assert.equal(warnings.length, 1);

    const unwired = await runnerFor(dir, {
      PreToolUse: [{ name: "unwired", matcher: "file", command: process.execPath, args: [script] }],
    });
    assert.equal((await unwired.runPre(ctx("read_file"))).decision, "allow");
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = original;
    resetJsonHookMatcherWarningsForTests();
    await rm(dir, { recursive: true, force: true });
  }
});

test("matcher bash does not spawn for read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-bash-only-"));
  try {
    const log = join(dir, "spawns.txt");
    const script = join(dir, "count.mjs");
    await writeFile(script, `import { appendFileSync } from "node:fs"; let raw = ""; process.stdin.on("data", (c) => { raw += c; }); process.stdin.on("end", () => appendFileSync(${JSON.stringify(log)}, "1\\n"));\n`);
    const runner = await runnerFor(dir, {
      PreToolUse: [{ name: "bash-only", matcher: "^bash$", command: process.execPath, args: [script] }],
    });
    assert.equal((await runner.runPre(ctx("read"))).decision, "allow");
    await assert.rejects(readFile(log, "utf8"));
    assert.equal((await runner.runPre(ctx("bash"))).decision, "allow");
    assert.equal((await readFile(log, "utf8")).trim(), "1");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("disabled-hooks disables named hooks and does not change permission decisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-disabled-"));
  try {
    const log = join(dir, "spawns.txt");
    const allow = join(dir, "allow.mjs");
    const deny = join(dir, "deny.mjs");
    const spawn = (tag, file, body) => writeFile(file, `import { appendFileSync } from "node:fs"; process.stdin.resume(); process.stdin.on("end", () => { appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(tag + "\n")}); console.log(${JSON.stringify(body)}); });\n`);
    await spawn("bypass", allow, JSON.stringify({ decision: "allow" }));
    await spawn("reader", deny, JSON.stringify({ decision: "deny", blockingError: "hook deny" }));
    await disableHook(dir, "bypass");
    await disableHook(dir, "write");
    const disabled = await readDisabledHookNames(dir);
    assert.deepEqual([...disabled].sort(), ["bypass", "write"]);
    const runner = await runnerFor(dir, {
      PreToolUse: [
        { name: "bypass", command: process.execPath, args: [allow] },
        { name: "reader", matcher: "^read$", command: process.execPath, args: [deny] },
      ],
    }, { disabledNames: disabled });
    const manager = new HookManager(tools, guard([
      { tool_pattern: "write", decision: "deny", reason: "permission deny write" },
    ]));
    manager.register("PreToolUse", (context) => runner.runPre(context));
    const writeResult = await manager.runPreHook(ctx("write"));
    assert.equal(writeResult.decision, "deny");
    assert.match(writeResult.blockingError, /permission deny write/);
    await assert.rejects(readFile(log, "utf8"));
    const readResult = await manager.runPreHook(ctx("read"));
    assert.equal(readResult.decision, "deny");
    assert.match(readResult.blockingError, /hook deny/);
    await enableHook(dir, "reader");
    await disableHook(dir, "reader");
    const reread = await readDisabledHookNames(dir);
    const runner2 = await runnerFor(dir, {
      PreToolUse: [
        { name: "bypass", command: process.execPath, args: [allow] },
        { name: "reader", matcher: "^read$", command: process.execPath, args: [deny] },
      ],
    }, { disabledNames: reread });
    const manager2 = new HookManager(tools, guard([
      { tool_pattern: "write", decision: "deny", reason: "permission deny write" },
    ]));
    manager2.register("PreToolUse", (context) => runner2.runPre(context));
    assert.equal((await manager2.runPreHook(ctx("read"))).decision, "allow");
    const writeAgain = await manager2.runPreHook(ctx("write"));
    assert.equal(writeAgain.decision, "deny");
    assert.match(writeAgain.blockingError, /permission deny write/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installJsonHooks reads the stateDir disabled-hooks list", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-install-"));
  const prevEnabled = process.env.QLING_JSON_HOOKS_ENABLED;
  const prevManifest = process.env.QLING_JSON_HOOKS_MANIFEST;
  try {
    const log = join(dir, "spawns.txt");
    const script = join(dir, "hook.mjs");
    await writeFile(script, `import { appendFileSync } from "node:fs"; process.stdin.resume(); process.stdin.on("end", () => appendFileSync(${JSON.stringify(log)}, "1\\n"));\n`);
    await writeFile(join(dir, "hooks.json"), JSON.stringify({
      events: { PreToolUse: [{ name: "skip-me", command: process.execPath, args: [script] }] },
    }));
    await disableHook(dir, "skip-me");
    process.env.QLING_JSON_HOOKS_ENABLED = "true";
    process.env.QLING_JSON_HOOKS_MANIFEST = join(dir, "hooks.json");
    const registered = [];
    const runner = await installJsonHooks({
      hookManager: { register(name) { registered.push(name); } },
      stateDir: dir,
      workspaceDir: dir,
      sessionId: "session-test",
      emitSessionStart: false,
    });
    assert.ok(runner);
    assert.deepEqual(registered, ["PreToolUse", "PostToolUse", "PostToolUseFailure"]);
    assert.equal((await runner.runPre(ctx("bash"))).decision, "allow");
    await assert.rejects(readFile(log, "utf8"));
  } finally {
    if (prevEnabled === undefined) delete process.env.QLING_JSON_HOOKS_ENABLED;
    else process.env.QLING_JSON_HOOKS_ENABLED = prevEnabled;
    if (prevManifest === undefined) delete process.env.QLING_JSON_HOOKS_MANIFEST;
    else process.env.QLING_JSON_HOOKS_MANIFEST = prevManifest;
    await rm(dir, { recursive: true, force: true });
  }
});

test("300KB arguments keep tool_name and hook_event_name within the payload cap", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-payload-"));
  const prev = process.env.QLING_JSON_HOOKS_MAX_PAYLOAD_BYTES;
  try {
    delete process.env.QLING_JSON_HOOKS_MAX_PAYLOAD_BYTES;
    assert.equal(jsonHooksMaxPayloadBytes({}), 128 * 1024);
    const payloadPath = join(dir, "stdin.txt");
    const script = join(dir, "dump.mjs");
    await writeFile(script, `import { writeFileSync } from "node:fs"; let raw = ""; process.stdin.on("data", (c) => { raw += c; }); process.stdin.on("end", () => { writeFileSync(${JSON.stringify(payloadPath)}, raw); console.log(JSON.stringify({ decision: "allow" })); });\n`);
    const runner = await runnerFor(dir, {
      PreToolUse: [{ command: process.execPath, args: [script] }],
    }, { maxPayloadBytes: 128 * 1024 });
    const huge = `测${"A".repeat(300 * 1024)}ENDMARKER_SHOULD_DROP`;
    const result = await runner.runPre(ctx("bash", { blob: huge }));
    assert.equal(result.decision, "ask");
    assert.match(result.additionalContexts.join("\n"), /truncated/);
    const stdin = await readFile(payloadPath);
    assert.ok(stdin.byteLength <= 128 * 1024);
    const text = stdin.toString("utf8");
    const parsed = JSON.parse(text);
    assert.equal(parsed.truncated, true);
    assert.equal(parsed.hook_event_name, "PreToolUse");
    assert.equal(parsed.tool_name, "bash");
    assert.equal(parsed.context.toolName, "bash");
    assert.equal(typeof parsed.context.arguments.blob, "string");
    assert.ok(parsed.context.arguments.blob.length < huge.length);
    assert.ok(Array.isArray(parsed.truncatedFields));
    assert.ok(parsed.truncatedFields.some((field) => String(field).includes("blob")));
    assert.equal(text.includes("ENDMARKER_SHOULD_DROP"), false);
    assert.equal(text.includes("\uFFFD"), false);
    const encoded = encodeHookPayload({
      hook_event_name: "PreToolUse",
      tool_name: "bash",
      context: { toolName: "bash", arguments: { blob: huge } },
    }, 128 * 1024);
    assert.ok(Buffer.byteLength(encoded, "utf8") <= 128 * 1024);
    const direct = JSON.parse(encoded);
    assert.equal(direct.truncated, true);
    assert.equal(direct.hook_event_name, "PreToolUse");
    assert.equal(direct.tool_name, "bash");
  } finally {
    if (prev === undefined) delete process.env.QLING_JSON_HOOKS_MAX_PAYLOAD_BYTES;
    else process.env.QLING_JSON_HOOKS_MAX_PAYLOAD_BYTES = prev;
    await rm(dir, { recursive: true, force: true });
  }
});

test("truncated PreToolUse fails closed at ask but a hook deny still wins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-trunc-decision-"));
  try {
    const allow = join(dir, "allow.mjs");
    const deny = join(dir, "deny.mjs");
    await writeFile(allow, "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ decision: 'allow' })));\n");
    await writeFile(deny, "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ decision: 'deny', blockingError: 'hook deny' })));\n");
    const huge = "B".repeat(300 * 1024);
    const allowed = await runnerFor(dir, {
      PreToolUse: [{ name: "allow-huge", command: process.execPath, args: [allow] }],
    }, { maxPayloadBytes: 128 * 1024 });
    const asked = await allowed.runPre(ctx("bash", { blob: huge }));
    assert.equal(asked.decision, "ask");
    assert.match(asked.additionalContexts.join("\n"), /truncated/);
    const deniedRunner = await runnerFor(dir, {
      PreToolUse: [{ name: "deny-huge", command: process.execPath, args: [deny] }],
    }, { maxPayloadBytes: 128 * 1024 });
    const denied = await deniedRunner.runPre(ctx("write", { blob: huge }));
    assert.equal(denied.decision, "deny");
    assert.match(denied.blockingError, /hook deny/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("untruncated PreToolUse keeps allow and deny and adds hook identity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-small-payload-"));
  try {
    const payloadPath = join(dir, "stdin.txt");
    const script = join(dir, "echo.mjs");
    await writeFile(script, `import { writeFileSync } from "node:fs"; let raw = ""; process.stdin.on("data", (c) => { raw += c; }); process.stdin.on("end", () => { writeFileSync(${JSON.stringify(payloadPath)}, raw); console.log(process.argv[2]); });\n`);
    const allowBody = JSON.stringify({ decision: "allow" });
    const denyBody = JSON.stringify({ decision: "deny", blockingError: "hook deny" });
    const allowRunner = await runnerFor(dir, {
      PreToolUse: [{ command: process.execPath, args: [script, allowBody] }],
    }, { maxPayloadBytes: 128 * 1024 });
    const allowed = await allowRunner.runPre(ctx("read", { path: "notes.txt" }));
    assert.equal(allowed.decision, "allow");
    const allowPayload = JSON.parse(await readFile(payloadPath, "utf8"));
    assert.equal(allowPayload.hook_event_name, "PreToolUse");
    assert.equal(allowPayload.tool_name, "read");
    assert.equal(allowPayload.context.toolName, "read");
    assert.equal(allowPayload.context.arguments.path, "notes.txt");
    assert.equal(allowPayload.truncated, undefined);
    const denyRunner = await runnerFor(dir, {
      PreToolUse: [{ command: process.execPath, args: [script, denyBody] }],
    }, { maxPayloadBytes: 128 * 1024 });
    const denied = await denyRunner.runPre(ctx("bash", { cmd: "echo hi" }));
    assert.equal(denied.decision, "deny");
    assert.match(denied.blockingError, /hook deny/);
    const denyPayload = JSON.parse(await readFile(payloadPath, "utf8"));
    assert.equal(denyPayload.truncated, undefined);
    assert.equal(denyPayload.tool_name, "bash");
    assert.equal(denyPayload.hook_event_name, "PreToolUse");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Stop hook blocks with a truncated reason and fails open on crash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-stop-"));
  try {
    const payloadPath = join(dir, "stop.txt");
    const script = join(dir, "stop.mjs");
    await writeFile(script, `import { writeFileSync } from "node:fs"; let raw = ""; process.stdin.on("data", (c) => { raw += c; }); process.stdin.on("end", () => { writeFileSync(${JSON.stringify(payloadPath)}, raw); console.log(JSON.stringify({ decision: "block", reason: "R".repeat(12000) })); });\n`);
    const runner = await runnerFor(dir, { Stop: [{ command: process.execPath, args: [script] }] });
    const decision = await runner.runStop({ lastAssistantText: "测".repeat(5000), stopHookActive: true });
    assert.equal(decision.blocked, true);
    assert.equal(decision.reason.length, 10000);
    const payload = JSON.parse(await readFile(payloadPath, "utf8"));
    assert.equal(payload.lastAssistantText.length, 2000);
    assert.equal(payload.stopHookActive, true);
    const crashed = await runnerFor(dir, { Stop: [{ command: "definitely-not-a-real-command" }] });
    assert.deepEqual(await crashed.runStop({ lastAssistantText: "bye", stopHookActive: false }), { blocked: false });
    const invalid = await runnerFor(dir, {
      Stop: [{ command: process.execPath, args: ["-e", "process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('nope'))"] }],
    });
    assert.equal((await invalid.runStop({ lastAssistantText: "bye", stopHookActive: false })).blocked, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("installJsonHooks warns once per regressed matcher and does not change decisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qling-hook-install-warn-"));
  const prevEnabled = process.env.QLING_JSON_HOOKS_ENABLED;
  const prevManifest = process.env.QLING_JSON_HOOKS_MANIFEST;
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(" "));
  resetJsonHookMatcherWarningsForTests();
  try {
    const script = join(dir, "deny.mjs");
    await writeFile(script, "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ decision: 'deny', blockingError: 'hook deny' })));\n");
    const anchoredManifest = join(dir, "anchored-hooks.json");
    const fileManifest = join(dir, "file-hooks.json");
    const command = { command: process.execPath, args: [script] };
    await writeFile(anchoredManifest, JSON.stringify({
      events: {
        PreToolUse: [
          { name: "still-patch", matcher: "patch", ...command },
          { name: "lost-anchored", matcher: "anchored", ...command },
        ],
      },
    }));
    await writeFile(fileManifest, JSON.stringify({
      events: {
        PreToolUse: [{ name: "lost-file", matcher: "file", ...command }],
      },
    }));
    process.env.QLING_JSON_HOOKS_ENABLED = "true";
    const knownToolNames = ["patch", "patch_anchored", "read_file"];
    const install = async (manifestPath, withNames) => {
      process.env.QLING_JSON_HOOKS_MANIFEST = manifestPath;
      return installJsonHooks({
        hookManager: { register() {} },
        stateDir: dir,
        workspaceDir: dir,
        sessionId: "session-warn",
        emitSessionStart: false,
        ...(withNames ? { knownToolNames } : {}),
      });
    };
    const names = ["patch_anchored", "patch", "read_file", "patch_anchored"];
    const collect = async (runner) => {
      const results = [];
      for (const name of names) results.push(await runner.runPre(ctx(name)));
      return results;
    };

    const plain = await install(anchoredManifest, false);
    const wired = await install(anchoredManifest, true);
    assert.ok(plain);
    assert.ok(wired);
    const plainDecisions = await collect(plain);
    assert.deepEqual(warnings, []);
    const wiredDecisions = await collect(wired);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /"anchored"/);
    assert.match(warnings[0], /substring/);
    assert.deepEqual(wiredDecisions, plainDecisions);
    assert.equal(wiredDecisions[0].decision, "deny");
    assert.equal(wiredDecisions[1].decision, "deny");
    assert.equal(wiredDecisions[2].decision, "allow");
    assert.equal(wiredDecisions[3].decision, "deny");
    await collect(wired);
    assert.equal(warnings.length, 1);

    const plainFile = await install(fileManifest, false);
    const wiredFile = await install(fileManifest, true);
    const plainFileDecisions = await collect(plainFile);
    assert.equal(warnings.length, 1);
    const wiredFileDecisions = await collect(wiredFile);
    assert.equal(warnings.length, 2);
    assert.match(warnings[1], /"file"/);
    assert.match(warnings[1], /substring/);
    assert.deepEqual(wiredFileDecisions, plainFileDecisions);
    assert.equal(wiredFileDecisions[0].decision, "allow");
    assert.equal(wiredFileDecisions[2].decision, "allow");
    await wired.runPre(ctx("patch_anchored"));
    await wiredFile.runPre(ctx("read_file"));
    assert.equal(warnings.length, 2);
  } finally {
    console.warn = originalWarn;
    resetJsonHookMatcherWarningsForTests();
    if (prevEnabled === undefined) delete process.env.QLING_JSON_HOOKS_ENABLED;
    else process.env.QLING_JSON_HOOKS_ENABLED = prevEnabled;
    if (prevManifest === undefined) delete process.env.QLING_JSON_HOOKS_MANIFEST;
    else process.env.QLING_JSON_HOOKS_MANIFEST = prevManifest;
    await rm(dir, { recursive: true, force: true });
  }
});
