import path from "node:path";
import { cp, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import type { DiscoveryManifest } from "../discovery-types.js";
import { verifyManifestSignature } from "../discovery-registry.js";

function trustedKeysFromEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  try {
    const parsed = JSON.parse(env.QLING_DISCOVERY_TRUSTED_KEYS ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

export async function installLocalPlugin(options: {
  sourceDir: string;
  stateDir: string;
  allowUnsigned?: boolean;
  force?: boolean;
  trustedKeys?: Record<string, string>;
}): Promise<{ manifest: DiscoveryManifest; destination: string; signatureVerified: boolean }> {
  const source = path.resolve(options.sourceDir);
  const info = await stat(source);
  if (!info.isDirectory()) throw new Error("plugin source must be a directory");
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8")) as DiscoveryManifest;
  if (!manifest?.id || !/^[a-z0-9][a-z0-9._-]{0,79}$/i.test(manifest.id)) {
    throw new Error("manifest.id must be a safe local plugin id");
  }
  if (!manifest.name || !manifest.version || !["skill", "mcp", "bundle"].includes(manifest.type)) {
    throw new Error("manifest requires name, version and a supported type");
  }
  const signatureVerified = verifyManifestSignature(
    manifest,
    options.trustedKeys ?? trustedKeysFromEnv()
  );
  if (!signatureVerified && !options.allowUnsigned) {
    throw new Error("plugin manifest signature is missing, unknown, or invalid; pass --allow-unsigned only for a reviewed local source");
  }
  const pluginsRoot = path.resolve(options.stateDir, "plugins");
  const destination = path.resolve(pluginsRoot, manifest.id);
  if (!destination.startsWith(pluginsRoot + path.sep)) throw new Error("plugin destination escaped state directory");
  if (source === destination || destination.startsWith(source + path.sep)) {
    throw new Error("plugin source and destination must not overlap");
  }
  await mkdir(pluginsRoot, { recursive: true });
  if (options.force) await rm(destination, { recursive: true, force: true });
  else {
    try {
      await stat(destination);
      throw new Error(`plugin '${manifest.id}' is already installed; use --force to replace it`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  return { manifest, destination, signatureVerified };
}

export async function listLocalPlugins(stateDir: string): Promise<DiscoveryManifest[]> {
  const root = path.join(stateDir, "plugins");
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const manifests: DiscoveryManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      manifests.push(JSON.parse(await readFile(path.join(root, entry.name, "manifest.json"), "utf8")));
    } catch {
      // Invalid installs are omitted; doctor/discovery can report them separately.
    }
  }
  return manifests.sort((a, b) => a.id.localeCompare(b.id));
}
