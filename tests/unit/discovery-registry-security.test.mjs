import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { DiscoveryRegistry } from "../../dist/discovery-registry.js";
import { guardConfigFromEnv } from "../../dist/config.js";

const manifest = {
  id: "remote-demo",
  name: "Remote Demo",
  version: "1.0.0",
  type: "skill",
  tools: [{ name: "remote_tool", description: "remote" }],
};

async function withAxiosGet(handler, fn) {
  const original = axios.get;
  axios.get = handler;
  try {
    await fn();
  } finally {
    axios.get = original;
  }
}

test("remote discovery rejects unsigned manifests by default", async () => {
  await withAxiosGet(async () => ({ data: manifest }), async () => {
    const registry = new DiscoveryRegistry(
      [{ id: "remote", uri: "https://example.com/manifest.json", type: "remote" }],
      {
        allowUnsigned: false,
        guardConfig: guardConfigFromEnv({ QLING_GUARD_ENABLED: "false" }),
      }
    );
    await registry.syncAll();
    assert.equal(registry.getAllItems().length, 0);
  });
});

test("remote discovery loads unsigned manifests only when explicitly allowed", async () => {
  let requestConfig;
  await withAxiosGet(async (_url, config) => {
    requestConfig = config;
    return { data: manifest };
  }, async () => {
    const registry = new DiscoveryRegistry(
      [{ id: "remote", uri: "https://example.com/manifest.json", type: "remote" }],
      {
        allowUnsigned: true,
        guardConfig: guardConfigFromEnv({ QLING_GUARD_ENABLED: "false" }),
      }
    );
    await registry.syncAll();
    assert.deepEqual(registry.getDiscoveredTools().map((tool) => tool.name), ["remote_tool"]);
    assert.deepEqual(registry.getExecutableTools(), []);
    assert.equal(requestConfig.maxRedirects, 0);
    assert.equal(requestConfig.maxContentLength, 1024 * 1024);
    assert.equal(requestConfig.maxBodyLength, 1024 * 1024);
  });
});

test("discovery sources requiring approval fail closed without an approval callback", async () => {
  let requests = 0;
  await withAxiosGet(async () => {
    requests++;
    return { data: manifest };
  }, async () => {
    const registry = new DiscoveryRegistry(
      [{
        id: "approval-required",
        uri: "https://example.com/manifest.json",
        type: "remote",
        requireApproval: true,
      }],
      {
        allowUnsigned: true,
        guardConfig: guardConfigFromEnv({ QLING_GUARD_ENABLED: "false" }),
      }
    );
    await registry.syncAll();
    assert.equal(requests, 0);
    assert.equal(registry.getAllItems().length, 0);
  });
});

test("remote discovery blocks private network URLs before Axios", async () => {
  let requests = 0;
  await withAxiosGet(async () => {
    requests++;
    return { data: manifest };
  }, async () => {
    const registry = new DiscoveryRegistry(
      [{ id: "private", uri: "http://127.0.0.1/manifest.json", type: "remote" }],
      {
        allowUnsigned: true,
        guardConfig: guardConfigFromEnv({ QLING_GUARD_ENABLED: "true" }),
      }
    );
    await registry.syncAll();
    assert.equal(requests, 0);
    assert.equal(registry.getAllItems().length, 0);
  });
});

test("remote discovery rejects malformed manifests", async () => {
  await withAxiosGet(async () => ({ data: { name: "missing id" } }), async () => {
    const registry = new DiscoveryRegistry(
      [{ id: "remote", uri: "https://example.com/manifest.json", type: "remote" }],
      {
        allowUnsigned: true,
        guardConfig: guardConfigFromEnv({ QLING_GUARD_ENABLED: "false" }),
      }
    );
    await registry.syncAll();
    assert.equal(registry.getAllItems().length, 0);
  });
});
