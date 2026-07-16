import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { canonicalManifestPayload } from "../../dist/discovery-registry.js";
import {
  installLocalPlugin,
  listLocalPlugins,
} from "../../dist/plugins/local-installer.js";

test("local plugin installer requires a trusted signature by default", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qling-plugin-"));
  try {
    const source = path.join(root, "source");
    const state = path.join(root, "state");
    await mkdir(source);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const manifest = {
      id: "signed-local",
      name: "Signed local",
      version: "1.0.0",
      type: "skill",
      publicKeyId: "publisher-1",
    };
    manifest.signature = sign(
      null,
      Buffer.from(canonicalManifestPayload(manifest), "utf8"),
      privateKey
    ).toString("base64");
    await writeFile(path.join(source, "manifest.json"), JSON.stringify(manifest));
    await writeFile(path.join(source, "SKILL.md"), "# Signed local\n");

    const installed = await installLocalPlugin({
      sourceDir: source,
      stateDir: state,
      trustedKeys: {
        "publisher-1": publicKey.export({ type: "spki", format: "pem" }).toString(),
      },
    });
    assert.equal(installed.signatureVerified, true);
    assert.equal(await readFile(path.join(installed.destination, "SKILL.md"), "utf8"), "# Signed local\n");
    assert.deepEqual((await listLocalPlugins(state)).map((item) => item.id), ["signed-local"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unsigned local plugin needs an explicit opt-in", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qling-plugin-"));
  try {
    const source = path.join(root, "source");
    const state = path.join(root, "state");
    await mkdir(source);
    await writeFile(path.join(source, "manifest.json"), JSON.stringify({
      id: "reviewed-local",
      name: "Reviewed local",
      version: "1.0.0",
      type: "bundle",
    }));
    await assert.rejects(
      installLocalPlugin({ sourceDir: source, stateDir: state }),
      /signature is missing/
    );
    const installed = await installLocalPlugin({
      sourceDir: source,
      stateDir: state,
      allowUnsigned: true,
    });
    assert.equal(installed.signatureVerified, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
