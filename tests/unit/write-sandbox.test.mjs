import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  checkSensitiveWriteTarget,
  isPathAllowedForWrite,
  resolveWriteSandboxMode,
  getRuntimeRootsFromEnv,
} from "../../dist/runtime-paths.js";
import { runWrite } from "../../dist/tools/write.js";
import { runPatch } from "../../dist/tools/patch.js";
import {
  resolveNetworkGuardMode,
  checkUrlFetchPolicy,
} from "../../dist/guard.js";

async function withEnv(patch, fn) {
  const prev = {};
  for (const key of Object.keys(patch)) {
    prev[key] = process.env[key];
    const value = patch[key];
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = String(value);
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

async function withTempWorkspace(fn) {
  const dir = await mkdtemp(join(tmpdir(), "qling-sandbox-"));
  await withEnv(
    {
      QLING_WORKSPACE_DIR: dir,
      QLING_FILE_STATE_DIR: join(dir, ".state"),
      QLING_FILE_CACHE_DIR: join(dir, ".cache"),
      QLING_WRITE_SANDBOX: "workspace",
      QLING_ALLOW_SENSITIVE_WRITE: undefined,
    },
    async () => {
      try {
        await fn(dir);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  );
}

test("resolveWriteSandboxMode defaults to workspace", () => {
  assert.equal(resolveWriteSandboxMode({}), "workspace");
  assert.equal(resolveWriteSandboxMode({ QLING_WRITE_SANDBOX: "roots" }), "roots");
  assert.equal(resolveWriteSandboxMode({ QLING_WRITE_SANDBOX: "off" }), "off");
});

test("isPathAllowedForWrite workspace mode blocks outside paths", () => {
  const roots = {
    workspaceDir: "C:\\repo\\proj",
    fileCacheDir: "C:\\repo\\proj\\.cache",
    fileStateDir: "C:\\Users\\me\\.qling",
  };
  assert.equal(isPathAllowedForWrite("C:\\repo\\proj\\a.ts", roots, "workspace"), true);
  assert.equal(isPathAllowedForWrite("C:\\Users\\me\\.qling\\x", roots, "workspace"), false);
  assert.equal(isPathAllowedForWrite("C:\\Users\\me\\.qling\\x", roots, "roots"), true);
});

test("checkSensitiveWriteTarget blocks .env and allows override", () => {
  const hit = checkSensitiveWriteTarget("C:\\repo\\.env", {});
  assert.equal(hit?.blocked, true);
  assert.equal(hit?.code, "WRITE_SENSITIVE_PATH");

  const ok = checkSensitiveWriteTarget("C:\\repo\\.env", { QLING_ALLOW_SENSITIVE_WRITE: "1" });
  assert.equal(ok, null);

  const pem = checkSensitiveWriteTarget("/tmp/cert.pem", {});
  assert.equal(pem?.blocked, true);
});

test("write: refuses .env inside workspace", async () => {
  await withTempWorkspace(async (dir) => {
    const result = await runWrite({ path: ".env", content: "API_KEY=secret\n" });
    assert.equal(result.is_error, true);
    assert.match(result.output, /WRITE_SENSITIVE_PATH|sensitive/i);
  });
});

test("write: allows normal file in workspace", async () => {
  await withTempWorkspace(async (dir) => {
    const result = await runWrite({ path: "ok.txt", content: "hello\n" });
    assert.equal(result.is_error, undefined);
    const text = await readFile(join(dir, "ok.txt"), "utf8");
    assert.equal(text, "hello\n");
  });
});

test("write: blocks path outside workspace sandbox", async () => {
  await withTempWorkspace(async (dir) => {
    const outside = resolve(dir, "..", "outside-qling-sandbox.txt");
    const result = await runWrite({ path: outside, content: "nope" });
    assert.equal(result.is_error, true);
    assert.match(result.output, /WRITE_OUTSIDE_ALLOWED_ROOT|outside write sandbox/i);
  });
});

test("patch: refuses sensitive path", async () => {
  await withTempWorkspace(async (dir) => {
    await writeFile(join(dir, ".env"), "A=1\n", "utf8");
    const result = await runPatch({
      path: ".env",
      chunks: [{ search: "A=1", replace: "A=2" }],
    });
    assert.equal(result.is_error, true);
    assert.match(result.output, /WRITE_SENSITIVE_PATH|sensitive/i);
  });
});

test("resolveNetworkGuardMode and deny mode", async () => {
  assert.equal(resolveNetworkGuardMode({}), "strict");
  assert.equal(resolveNetworkGuardMode({ QLING_GUARD_NETWORK_MODE: "open" }), "open");
  assert.equal(resolveNetworkGuardMode({ QLING_GUARD_NETWORK_MODE: "deny" }), "deny");

  const guard = {
    enabled: true,
    network: {
      url_fetch: {
        allowed_url_prefixes: ["https://"],
        deny_private_ips: true,
        follow_redirects: false,
      },
    },
    redaction: { enabled: false, patterns: [] },
    audit: { jsonl_path: "" },
    rate_limit: { enabled: false, max_per_minute: 0 },
    content_filter: {
      enabled: false,
      pii_detection: false,
      injection_detection: false,
      custom_patterns: [],
    },
    permissions: { default: "allow", rules: [] },
  };

  const denied = await checkUrlFetchPolicy(
    new URL("https://example.com"),
    guard,
    { QLING_GUARD_NETWORK_MODE: "deny" }
  );
  assert.equal(denied.allowed, false);
  assert.match(String(denied.reason), /deny/i);

  const openHttp = await checkUrlFetchPolicy(
    new URL("http://example.com"),
    guard,
    { QLING_GUARD_NETWORK_MODE: "open" }
  );
  assert.equal(openHttp.allowed, true);

  const strictHttp = await checkUrlFetchPolicy(
    new URL("http://example.com"),
    guard,
    { QLING_GUARD_NETWORK_MODE: "strict" }
  );
  assert.equal(strictHttp.allowed, false);
});

test("getRuntimeRootsFromEnv still resolves dirs", () => {
  const roots = getRuntimeRootsFromEnv({
    QLING_WORKSPACE_DIR: "C:\\w",
    QLING_FILE_STATE_DIR: "C:\\s",
    QLING_FILE_CACHE_DIR: "C:\\c",
  });
  assert.ok(roots.workspaceDir);
  assert.ok(roots.fileStateDir);
  assert.ok(roots.fileCacheDir);
});
