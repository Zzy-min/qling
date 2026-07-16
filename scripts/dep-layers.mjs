#!/usr/bin/env node
/**
 * Phase 4.4 — 扫描 src 相对 import，输出分层依赖边（供架构文档/CI 门禁）
 * Usage: node scripts/dep-layers.mjs [--json] [--strict]
 *
 * --strict: 若发现禁止的反向依赖边，exit 1
 */
import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import { join, relative, dirname, extname, resolve } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");

/** @typedef {'foundation'|'core-services'|'domain'|'agent-runtime'|'adapters'|'presentation'|'cli'|'other'} Layer */

/**
 * @param {string} rel posix path under src/
 * @returns {Layer}
 */
export function layerOf(rel) {
  const p = rel.replace(/\\/g, "/");
  if (
    p === "types.ts" ||
    p === "config.ts" ||
    p === "runtime-paths.ts" ||
    p === "token-usage.ts" ||
    p === "context-budget.ts" ||
    p === "usage-ledger.ts" ||
    p === "package-version.ts" ||
    p === "output-style.ts" ||
    p.startsWith("utils/") ||
    p.startsWith("i18n/") ||
    p.startsWith("providers/")
  ) {
    return "foundation";
  }
  if (
    p.startsWith("pipeline/") ||
    p.startsWith("plan/") ||
    p.startsWith("guard/") ||
    p === "guard.ts" ||
    p.startsWith("lsp/") ||
    p === "context-compactor.ts" ||
    p === "context-tool-hygiene.ts" ||
    p.startsWith("git/")
  ) {
    return "core-services";
  }
  if (
    p.startsWith("memory/") ||
    p === "memory.ts" ||
    p.startsWith("session/") ||
    p.startsWith("mission/") ||
    p.startsWith("mcp/") ||
    p.startsWith("channels/") ||
    p.startsWith("skills/") ||
    p.startsWith("metrics/") ||
    p.startsWith("agents/") ||
    p.startsWith("onboarding/") ||
    p.startsWith("workflow-") ||
    p === "discovery-registry.ts" ||
    p === "discovery-types.ts" ||
    p === "knowledge-agent.ts"
  ) {
    return "domain";
  }
  if (
    p === "agent-loop.ts" ||
    p.startsWith("agent/") ||
    p.startsWith("tools/") ||
    p.startsWith("execution/") ||
    p === "slash-context.ts" ||
    p === "slash-ports.ts" ||
    p === "repl.ts"
  ) {
    return "agent-runtime";
  }
  if (
    p === "sdk.ts" ||
    p === "daemon.ts" ||
    p === "dashboard-server.ts" ||
    p.startsWith("dashboard/") ||
    p.endsWith("-report.ts") ||
    p === "doctor.ts" ||
    p === "statusline.ts" ||
    p === "shortcuts.ts" ||
    p === "help-topics.ts" ||
    p === "recap.ts" ||
    p.startsWith("session-") ||
    p.startsWith("local-") ||
    p.startsWith("eval/")
  ) {
    return "adapters";
  }
  if (p.startsWith("tui/")) return "presentation";
  if (p === "index.ts" || p.startsWith("cli/") || p.startsWith("commands/")) {
    return "cli";
  }
  return "other";
}

/** 允许的依赖方向：上层 → 下层（数字越小越底层） */
export const LAYER_RANK = {
  foundation: 0,
  "core-services": 1,
  domain: 2,
  "agent-runtime": 3,
  adapters: 4,
  presentation: 5,
  cli: 6,
  other: 3,
};

/**
 * 禁止的边：下层依赖上层
 * @param {Layer} from
 * @param {Layer} to
 */
export function isForbiddenEdge(from, to) {
  if (from === to) return false;
  const a = LAYER_RANK[from] ?? 99;
  const b = LAYER_RANK[to] ?? 99;
  // 允许同层外：from 只能依赖 rank <= from 的层（含向下）
  // 禁止：from.rank < to.rank（下层依赖上层）—— 不对：
  // foundation rank 0 依赖 cli rank 6 是禁止的 (0 < 6 且 from is lower)
  // cli 依赖 foundation: 6 > 0 OK
  // foundation 依赖 cli: 0 < 6 FORBIDDEN
  return a < b;
}

async function walk(dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else if (e.isFile() && extname(e.name) === ".ts") acc.push(p);
  }
  return acc;
}

function resolveImport(fromFile, spec) {
  let target = resolve(dirname(fromFile), spec);
  target = target.replace(/\\/g, "/");
  if (target.endsWith(".js")) target = target.slice(0, -3) + ".ts";
  else if (!target.endsWith(".ts")) {
    // bare directory index not common; try .ts
    if (existsSync(target + ".ts")) target = target + ".ts";
    else if (existsSync(join(target, "index.ts"))) target = join(target, "index.ts");
    else target = target + ".ts";
  }
  return target;
}

export async function scanLayers() {
  const files = await walk(SRC);
  /** @type {Map<string, number>} */
  const edgeCounts = new Map();
  /** @type {Array<{from:string,to:string,fromLayer:string,toLayer:string}>} */
  const forbidden = [];
  /** @type {Record<string, number>} */
  const layerCounts = {};

  for (const f of files) {
    const rel = relative(SRC, f).replace(/\\/g, "/");
    const fromL = layerOf(rel);
    layerCounts[fromL] = (layerCounts[fromL] || 0) + 1;
    const text = await readFile(f, "utf8");
    const re = /from\s+['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text))) {
      const targetAbs = resolveImport(f, m[1]);
      const tRel = relative(SRC, targetAbs).replace(/\\/g, "/");
      if (tRel.startsWith("..")) continue;
      if (!tRel.endsWith(".ts") && !existsSync(join(SRC, tRel))) continue;
      const toL = layerOf(tRel);
      if (fromL === toL) continue;
      const key = `${fromL}->${toL}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
      if (isForbiddenEdge(fromL, toL)) {
        forbidden.push({
          from: rel,
          to: tRel,
          fromLayer: fromL,
          toLayer: toL,
        });
      }
    }
  }

  return {
    fileCount: files.length,
    layerCounts,
    edges: [...edgeCounts.entries()]
      .map(([edge, count]) => ({ edge, count }))
      .sort((a, b) => b.count - a.count),
    forbidden: forbidden.slice(0, 200),
    forbiddenCount: forbidden.length,
  };
}

function formatMermaid(layerCounts, edges) {
  const lines = ["```mermaid", "flowchart TB"];
  const order = [
    "foundation",
    "core-services",
    "domain",
    "agent-runtime",
    "adapters",
    "presentation",
    "cli",
    "other",
  ];
  for (const l of order) {
    if (layerCounts[l]) {
      lines.push(`  ${l.replace(/-/g, "_")}["${l} (${layerCounts[l]})"]`);
    }
  }
  // unique edges for diagram (not forbidden only — all)
  const seen = new Set();
  for (const { edge } of edges) {
    const [a, b] = edge.split("->");
    const id = `${a}->${b}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const fa = a.replace(/-/g, "_");
    const fb = b.replace(/-/g, "_");
    const bad = isForbiddenEdge(/** @type {any} */ (a), /** @type {any} */ (b));
    lines.push(`  ${fa} ${bad ? "-.->|forbidden|" : "-->"} ${fb}`);
  }
  lines.push("```");
  return lines.join("\n");
}

const asJson = process.argv.includes("--json");
const strict = process.argv.includes("--strict");
const baselineMode = process.argv.includes("--baseline");
const writeBaseline = process.argv.includes("--write-baseline");
const writeDoc = process.argv.includes("--write-doc");
const BASELINE_PATH = join(ROOT, "docs", "dependency-layers.baseline.json");

function edgeKey(f) {
  return `${f.fromLayer}->${f.toLayer}::${f.from}::${f.to}`;
}

const result = await scanLayers();

if (asJson) {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} else {
  console.log(`src files: ${result.fileCount}`);
  console.log("layer counts:", result.layerCounts);
  console.log("cross-layer edges:");
  for (const e of result.edges) console.log(`  ${e.count}\t${e.edge}`);
  console.log(`forbidden reverse edges: ${result.forbiddenCount}`);
  if (result.forbiddenCount > 0) {
    console.log("sample forbidden (up to 15):");
    for (const f of result.forbidden.slice(0, 15)) {
      console.log(`  ${f.fromLayer} -> ${f.toLayer}: ${f.from} imports ${f.to}`);
    }
  }
  console.log("\n" + formatMermaid(result.layerCounts, result.edges));
}

if (writeDoc) {
  const outDir = join(ROOT, "docs");
  await mkdir(outDir, { recursive: true });
  // doc written by separate architecture file; optional snapshot
  const snap = join(outDir, "dependency-layers.snapshot.json");
  await writeFile(
    snap,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        ...result,
        forbidden: result.forbidden.slice(0, 50),
      },
      null,
      2
    ),
    "utf8"
  );
  console.error(`[dep-layers] wrote ${snap}`);
}

if (writeBaseline) {
  await mkdir(dirname(BASELINE_PATH), { recursive: true });
  const keys = result.forbidden.map(edgeKey).sort();
  await writeFile(
    BASELINE_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        note: "Known reverse-layer edges. --baseline fails only on NEW keys not listed here.",
        forbiddenCount: keys.length,
        forbidden: keys,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  console.error(`[dep-layers] wrote baseline ${BASELINE_PATH} (${keys.length} edges)`);
}

if (baselineMode) {
  let known = new Set();
  if (existsSync(BASELINE_PATH)) {
    const raw = JSON.parse(await readFile(BASELINE_PATH, "utf8"));
    known = new Set(raw.forbidden || []);
  }
  const novel = result.forbidden.filter((f) => !known.has(edgeKey(f)));
  console.log(
    `baseline gate: known=${known.size} current=${result.forbiddenCount} novel=${novel.length}`
  );
  if (novel.length > 0) {
    console.error("NEW forbidden edges (not in baseline):");
    for (const f of novel) {
      console.error(`  ${f.fromLayer} -> ${f.toLayer}: ${f.from} imports ${f.to}`);
    }
    process.exit(1);
  }
}

if (strict && result.forbiddenCount > 0) {
  process.exit(1);
}
