import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSensitiveWriteTarget, runWithRuntimeRoots } from "../../dist/runtime-paths.js";
import { runRead } from "../../dist/tools/read.js";
import { runWrite } from "../../dist/tools/write.js";
import { runPatch } from "../../dist/tools/patch.js";
import { HookManager } from "../../dist/pipeline/hooks.js";
import { urlFetchTool } from "../../dist/tools/url-fetch.js";
import { classifyToolInvocation } from "../../dist/harness/tool-capability.js";
import { getPermissionGrantStore } from "../../dist/guard/permission-grants.js";

test("file tools reject junction escapes while preserving ordinary and in-root linked files", async () => {
  const root = await mkdtemp(join(tmpdir(), "qling-boundary-"));
  const ws = join(root, "ws"), outside = join(root, "outside");
  const prev = process.env.QLING_SANDBOX_PROFILE;
  process.env.QLING_SANDBOX_PROFILE = "workspace";
  try {
    await mkdir(ws); await mkdir(outside); await mkdir(join(ws, "inside"));
    await writeFile(join(outside, "canary.txt"), "original");
    await symlink(outside, join(ws, "escape"), process.platform === "win32" ? "junction" : "dir");
    await symlink(join(ws, "inside"), join(ws, "local"), process.platform === "win32" ? "junction" : "dir");
    await symlink(join(ws, "inside"), join(ws, ".env"), process.platform === "win32" ? "junction" : "dir");
    assert.equal(checkSensitiveWriteTarget(join(ws, ".env"))?.blocked, true);
    await runWithRuntimeRoots({ workspaceDir: ws, fileStateDir: join(ws, ".qling"), fileCacheDir: join(ws, ".qling/cache") }, async () => {
      assert.equal((await runRead({ path: "escape/canary.txt" })).is_error, true);
      assert.equal((await runWrite({ path: "escape/new/deep.txt", content: "bad" })).is_error, true);
      assert.equal((await runPatch({ path: "escape/canary.txt", chunks: [{ search: "original", replace: "bad" }] })).is_error, true);
      assert.notEqual((await runWrite({ path: "local/good.txt", content: "good" })).is_error, true);
      assert.equal((await runRead({ path: "local/good.txt" })).output.includes("good"), true);
    });
    assert.equal(await readFile(join(outside, "canary.txt"), "utf8"), "original");
  } finally {
    if (prev === undefined) delete process.env.QLING_SANDBOX_PROFILE; else process.env.QLING_SANDBOX_PROFILE = prev;
    await rm(root, { recursive: true, force: true });
  }
});

for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  test(`Plan mode denies url_fetch ${method} and classifies external effects`, async () => {
    const args = { url: "https://example.invalid", method };
    const capability = classifyToolInvocation({ name: "url_fetch", definition: urlFetchTool, arguments: args });
    assert.equal(capability.sideEffect, "external");
    assert.equal(capability.readOnly, false);
    const manager = new HookManager([urlFetchTool]);
    manager.setPlanMode(true);
    const result = await manager.runPreHook({ toolName: "url_fetch", arguments: args, inputSchema: urlFetchTool.parameters, isReadOnly: true, isDestructive: false, isConcurrencySafe: true, dangerousPatterns: [] });
    assert.equal(result.decision, "deny");
  });
}

test("Plan mode retains url_fetch GET", async () => {
  const manager = new HookManager([urlFetchTool]); manager.setPlanMode(true);
  const result = await manager.runPreHook({ toolName: "url_fetch", arguments: { url: "https://example.invalid" }, inputSchema: urlFetchTool.parameters, isReadOnly: true, isDestructive: false, isConcurrencySafe: true, dangerousPatterns: [] });
  assert.equal(result.decision, "allow");
});

test("an existing url_fetch grant cannot authorize a new HTTP write", async () => {
  const grants = getPermissionGrantStore();
  grants.remember("url_fetch");
  try {
    const manager = new HookManager([urlFetchTool]);
    const result = await manager.runPreHook({ toolName: "url_fetch", arguments: { url: "https://example.invalid", method: "DELETE" }, inputSchema: urlFetchTool.parameters, isReadOnly: true, isDestructive: false, isConcurrencySafe: true, dangerousPatterns: [] });
    assert.equal(result.decision, "ask");
  } finally { grants.clear(); }
});
