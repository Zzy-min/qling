#!/usr/bin/env node
/** Copy packaging/scoop/qling.json → packaging/scoop-bucket/qling.json */
import { copyFile, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "packaging", "scoop", "qling.json");
const dest = join(root, "packaging", "scoop-bucket", "qling.json");
await copyFile(src, dest);
const j = JSON.parse(await readFile(dest, "utf8"));
console.log(`sync-scoop-bucket OK → v${j.version} hash=${j.hash?.slice(0, 20)}…`);
