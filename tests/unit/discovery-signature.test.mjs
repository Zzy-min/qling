import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  canonicalManifestPayload,
  verifyManifestSignature,
} from "../../dist/discovery-registry.js";

test("discovery manifest verifies an Ed25519 signature against a trusted key id", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const manifest = {
    id: "signed-plugin",
    name: "Signed plugin",
    version: "1.0.0",
    type: "skill",
    publicKeyId: "publisher-1",
  };
  manifest.signature = sign(
    null,
    Buffer.from(canonicalManifestPayload(manifest), "utf8"),
    privateKey
  ).toString("base64");
  const trusted = {
    "publisher-1": publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
  assert.equal(verifyManifestSignature(manifest, trusted), true);
  assert.equal(verifyManifestSignature({ ...manifest, version: "2.0.0" }, trusted), false);
});
