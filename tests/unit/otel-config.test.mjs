import test from "node:test";
import assert from "node:assert/strict";

import { resolveOtelExportConfig } from "../../dist/metrics/otel-config.js";

test("OTEL stays off without the first opt-in", () => {
  const config = resolveOtelExportConfig({
    QLING_OTEL_EXPORT_CONFIRM: "metadata-only",
    QLING_METRICS_OTEL_ENDPOINT: "https://collector.example/v1/traces",
  });
  assert.equal(config.state, "off");
  assert.equal(config.endpoint, undefined);
});

test("OTEL stays armed without metadata-only confirmation", () => {
  const config = resolveOtelExportConfig({
    QLING_METRICS_OTEL_ENABLED: "true",
    QLING_METRICS_OTEL_ENDPOINT: "https://collector.example/v1/traces",
  });
  assert.equal(config.state, "armed");
  assert.equal(config.endpoint, undefined);
});

test("OTEL enables only with both opt-ins and a safe endpoint", () => {
  const config = resolveOtelExportConfig({
    QLING_METRICS_OTEL_ENABLED: "true",
    QLING_OTEL_EXPORT_CONFIRM: "metadata-only",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/base/",
    OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20secret,x-tenant=test",
  });
  assert.equal(config.state, "enabled");
  assert.equal(config.endpoint, "https://collector.example/base/v1/traces");
  assert.equal(config.displayEndpoint, "https://collector.example");
  assert.deepEqual(config.headers, { authorization: "Bearer secret", "x-tenant": "test" });
});

test("OTEL rejects endpoint credentials, query, hash and non-http protocols", () => {
  for (const endpoint of [
    "https://user:pass@collector.example/v1/traces",
    "https://collector.example/v1/traces?token=secret",
    "https://collector.example/v1/traces#secret",
    "file:///tmp/traces",
  ]) {
    const config = resolveOtelExportConfig({
      QLING_METRICS_OTEL_ENABLED: "true",
      QLING_OTEL_EXPORT_CONFIRM: "metadata-only",
      QLING_METRICS_OTEL_ENDPOINT: endpoint,
    });
    assert.equal(config.state, "invalid");
    assert.equal(config.displayEndpoint, "-");
    assert.doesNotMatch(config.reason, /user|pass|token|tmp/);
  }
});
