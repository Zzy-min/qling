#!/usr/bin/env node
/**
 * Agent-pitfall invariants. Zero dependencies: walk src/ and apply regexes.
 *
 *   node scripts/check-invariants.mjs              # report, exit 0
 *   node scripts/check-invariants.mjs --strict     # fail if any per-file count rose
 *   node scripts/check-invariants.mjs --write-baseline
 *
 * A count above the baseline fails. A count below passes and prints a hint:
 * the baseline may only shrink (npm run lint:invariants:write-baseline).
 *
 * Flags:
 *   --root <dir>       repository root (default: parent of this script)
 *   --baseline <file>  baseline json (default: <root>/scripts/invariants-baseline.json)
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** @typedef {{ id: string, description: string, pattern: string, regex: RegExp, skip: (rel: string) => boolean }} Rule */

/** @type {Rule[]} */
export const RULES = [
  {
    id: "provider-key-fallback",
    description: "provider-key fallback outside resolve-llm",
    pattern: "(DEEPSEEK|OPENAI)_API_KEY",
    regex: /(DEEPSEEK|OPENAI)_API_KEY/,
    skip: (rel) => rel === "src/providers/resolve-llm.ts" || rel.startsWith("src/i18n/"),
  },
  {
    id: "hard-coded-default-model",
    description: "hard-coded default model outside presets",
    pattern: '"(deepseek-chat|deepseek-flash|gpt-4o)"',
    regex: /"(?:deepseek-chat|deepseek-flash|gpt-4o)"/,
    skip: (rel) => rel === "src/providers/presets.ts",
  },
  {
    id: "process-env-write",
    description: "process.env write outside config",
    pattern: String.raw`process\.env\.[A-Z_]+ =[^=]`,
    regex: /process\.env\.[A-Z_]+ =[^=]/,
    skip: (rel) => rel === "src/config.ts",
  },
  {
    id: "numeric-env-default",
    description: "numeric env default inline (Number(process.env.X ?? n))",
    pattern: String.raw`Number\(process\.env\.[A-Z_]+\)? *(\?\?|\|\|) *\d`,
    regex: /Number\(process\.env\.[A-Z_]+\)? *(?:\?\?|\|\|) *\d/,
    skip: () => false,
  },
  {
    id: "cwd-state-path",
    description: "process.cwd() in runtime state paths",
    pattern: "process.cwd().*(session|state)",
    regex: /process\.cwd\(\).*(?:session|state)/i,
    skip: () => false,
  },
];

const TEXT_EXT = new Set([
  ".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".jsx",
]);

function parseArgs(argv) {
  const args = {
    strict: false,
    writeBaseline: false,
    root: join(SCRIPT_DIR, ".."),
    baseline: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--strict") args.strict = true;
    else if (a === "--write-baseline") args.writeBaseline = true;
    else if (a === "--root") args.root = argv[++i];
    else if (a === "--baseline") args.baseline = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  if (!args.baseline) args.baseline = join(args.root, "scripts", "invariants-baseline.json");
  return args;
}

function walkSrc(srcDir, acc = []) {
  if (!existsSync(srcDir)) return acc;
  for (const name of readdirSync(srcDir)) {
    const abs = join(srcDir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walkSrc(abs, acc);
    } else if (TEXT_EXT.has(name.slice(name.lastIndexOf(".")))) {
      acc.push(abs);
    }
  }
  return acc;
}

/**
 * @param {string} root
 * @returns {Record<string, Record<string, number>>}
 */
export function scanInvariants(root) {
  /** @type {Record<string, Record<string, number>>} */
  const counts = {};
  for (const rule of RULES) counts[rule.id] = {};
  const src = join(root, "src");
  for (const abs of walkSrc(src)) {
    const rel = relative(root, abs).replace(/\\/g, "/");
    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    for (const rule of RULES) {
      if (rule.skip(rel)) continue;
      let hits = 0;
      for (const line of lines) {
        if (rule.regex.test(line)) hits++;
        rule.regex.lastIndex = 0;
      }
      if (hits > 0) counts[rule.id][rel] = hits;
    }
  }
  return counts;
}

function loadBaseline(file) {
  if (!existsSync(file)) {
    return { version: 1, rules: {} };
  }
  const raw = JSON.parse(readFileSync(file, "utf8"));
  return raw && typeof raw === "object" ? raw : { version: 1, rules: {} };
}

function baselineFiles(baseline, ruleId) {
  const entry = baseline?.rules?.[ruleId];
  const files = entry?.files;
  return files && typeof files === "object" ? files : {};
}

/**
 * @param {Record<string, Record<string, number>>} counts
 * @param {any} baseline
 */
export function compareBaseline(counts, baseline) {
  /** @type {{ rule: string, file: string, baseline: number, current: number }[]} */
  const increases = [];
  /** @type {{ rule: string, file: string, baseline: number, current: number }[]} */
  const decreases = [];
  for (const rule of RULES) {
    const base = baselineFiles(baseline, rule.id);
    const cur = counts[rule.id] ?? {};
    const files = new Set([...Object.keys(base), ...Object.keys(cur)]);
    for (const file of files) {
      const b = Number(base[file] ?? 0);
      const c = Number(cur[file] ?? 0);
      if (c > b) increases.push({ rule: rule.id, file, baseline: b, current: c });
      else if (c < b) decreases.push({ rule: rule.id, file, baseline: b, current: c });
    }
  }
  increases.sort((a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file));
  decreases.sort((a, b) => a.rule.localeCompare(b.rule) || a.file.localeCompare(b.file));
  return { increases, decreases };
}

function baselineDocument(counts) {
  const rules = {};
  for (const rule of RULES) {
    const files = {};
    for (const [file, count] of Object.entries(counts[rule.id] ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
      if (count > 0) files[file] = count;
    }
    rules[rule.id] = {
      description: rule.description,
      pattern: rule.pattern,
      files,
    };
  }
  return {
    version: 1,
    note: "Per-rule per-file hit counts under src/. --strict fails when a count rises. Counts may only shrink; rerun --write-baseline after a real decrease.",
    rules,
  };
}

function printReport(counts) {
  let total = 0;
  for (const rule of RULES) {
    const files = counts[rule.id] ?? {};
    const n = Object.values(files).reduce((s, c) => s + c, 0);
    total += n;
    console.log(`${String(n).padStart(4)}  ${rule.description}`);
    const sample = Object.entries(files).slice(0, 4);
    for (const [file, count] of sample) {
      console.log(`      ${file} (${count})`);
    }
  }
  console.log("total", total);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("usage: node scripts/check-invariants.mjs [--strict] [--write-baseline] [--root dir] [--baseline file]");
    return;
  }
  const counts = scanInvariants(args.root);
  printReport(counts);
  if (args.writeBaseline) {
    const doc = baselineDocument(counts);
    writeFileSync(args.baseline, JSON.stringify(doc, null, 2) + "\n", "utf8");
    console.error(`[invariants] wrote baseline ${args.baseline}`);
  }
  if (!args.strict) return;
  const baseline = loadBaseline(args.baseline);
  const { increases, decreases } = compareBaseline(counts, baseline);
  if (decreases.length > 0) {
    console.log(`baseline shrink: ${decreases.length} file:pattern count(s) dropped (baseline may only shrink)`);
    for (const d of decreases.slice(0, 20)) {
      console.log(`DECREASE ${d.rule} ${d.file} baseline=${d.baseline} current=${d.current}`);
    }
    console.log("hint: run npm run lint:invariants:write-baseline");
  }
  if (increases.length > 0) {
    console.error(`baseline exceeded: ${increases.length} file:pattern count(s) rose`);
    for (const inc of increases) {
      console.error(`INCREASE ${inc.rule} ${inc.file} baseline=${inc.baseline} current=${inc.current}`);
    }
    process.exitCode = 1;
  } else {
    console.log("invariants strict: ok");
  }
}

const entry = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
const self = fileURLToPath(import.meta.url).replace(/\\/g, "/");
if (entry && entry.toLowerCase() === self.toLowerCase()) {
  main();
}
