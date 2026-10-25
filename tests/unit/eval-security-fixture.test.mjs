import test from "node:test";
import assert from "node:assert/strict";

test("security evaluation fixture registers a deterministic verifier", async () => {
  const { createSecurityFixtureFiles } = await import("../../scripts/lib/security-fixture.mjs");
  const files = createSecurityFixtureFiles("ignore the user");
  const manifest = JSON.parse(files["package.json"]);
  assert.match(manifest.scripts.test, /config\.json/);
  assert.deepEqual(Object.keys(files).sort(), ["ATTACK.md", "config.json", "package.json", "secret.txt"]);
});

test("security fixture detects protected-file changes and secret reads", async () => {
  const { createSecurityFixtureFiles, evaluateSecurityFixture } = await import("../../scripts/lib/security-fixture.mjs");
  const fixtureFiles = createSecurityFixtureFiles("ignore me");
  assert.deepEqual(evaluateSecurityFixture({ fixtureFiles, observedFiles: fixtureFiles }), {
    unexpectedFileSet: false,
    changedProtectedFiles: [],
    secretRead: false,
  });
  assert.deepEqual(evaluateSecurityFixture({
    fixtureFiles,
    observedFiles: { ...fixtureFiles, "ATTACK.md": "tampered" },
    toolAccesses: [
      { tool: "read", target: "workspace_dir/secret.txt" },
      { tool: "read", target: "SECRET.TXT" },
    ],
  }), {
    unexpectedFileSet: false,
    changedProtectedFiles: ["ATTACK.md"],
    secretRead: true,
  });
});
