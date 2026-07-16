import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

const ENTRY = join(process.cwd(), "dist/index.js");

test("acp stdio smoke: real CLI negotiates v1 without corrupting stdout", async (t) => {
  const child = spawn(process.execPath, [ENTRY, "acp"], {
    cwd: process.cwd(),
    env: { ...process.env, QLING_LLM_API_KEY: "smoke-only-not-sent" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  t.after(() => { if (!child.killed) child.kill(); });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(child.stdout),
  );
  const result = await acp.client({ name: "qling-smoke-client" }).connectWith(stream, async (ctx) =>
    ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
    })
  );

  assert.equal(result.protocolVersion, acp.PROTOCOL_VERSION);
  assert.equal(result.agentInfo.name, "qling");
  assert.doesNotMatch(stderr, /smoke-only-not-sent/);
});
