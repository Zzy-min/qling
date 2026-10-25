import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { Dirent } from "node:fs";
import { extractSymbols as fallbackExtractSymbols } from "../utils/symbol-extractor.js";
import type { RepoEdge, RepoFileRecord, RepoIndexSnapshot, RepoMapResult, SymbolRecord } from "./types.js";

const execFileAsync = promisify(execFile);
const PARSER_VERSION = "repo-index-v1";
const MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_IGNORES = new Set([
  ".git", ".qling", "node_modules", "dist", "build", "coverage", "target", "out",
  ".idea", ".vscode", ".venv", "venv", "__pycache__", "vendor", "bin", "obj",
]);
const SECRET_NAMES = /^(?:\.env(?:\..*)?|id_rsa|id_ed25519|credentials(?:\.json)?|secrets?\.(?:json|ya?ml|toml))$/i;
const EXTENSIONS = new Map([
  [".ts", "TypeScript"], [".mts", "TypeScript"], [".cts", "TypeScript"],
  [".tsx", "Tsx"], [".js", "JavaScript"], [".jsx", "JavaScript"], [".mjs", "JavaScript"], [".cjs", "JavaScript"],
  [".py", "Python"], [".go", "Go"], [".java", "Java"], [".rs", "Rust"],
]);

interface CachedFile {
  record: RepoFileRecord;
  symbols: SymbolRecord[];
  imports: string[];
  mtimeMs?: number;
}

interface RepoIndexCache {
  parserVersion: string;
  files: Record<string, CachedFile>;
}

interface AstRuntime {
  parse: (language: string, source: string) => { root(): AstNode };
}

interface AstNode {
  kind(): string;
  text(): string;
  range(): { start: { line: number }; end: { line: number } };
  children(): AstNode[];
  field(name: string): AstNode | null;
}

let astRuntimePromise: Promise<AstRuntime | null> | null = null;

async function loadAstRuntime(): Promise<AstRuntime | null> {
  if (!astRuntimePromise) {
    astRuntimePromise = (async () => {
      try {
        const napi = await import("@ast-grep/napi");
        const [python, go, java, rust] = await Promise.all([
          import("@ast-grep/lang-python"),
          import("@ast-grep/lang-go"),
          import("@ast-grep/lang-java"),
          import("@ast-grep/lang-rust"),
        ]);
        napi.registerDynamicLanguage({
          Python: python.default,
          Go: go.default,
          Java: java.default,
          Rust: rust.default,
        });
        const parse = (napi as unknown as { parse: AstRuntime["parse"] }).parse;
        return { parse };
      } catch {
        return null;
      }
    })();
  }
  return astRuntimePromise;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRelative(value: string): string {
  return value.split(path.sep).join("/");
}

function symbolKind(nodeKind: string): string | null {
  if (/function|method|constructor/.test(nodeKind)) return nodeKind.includes("method") ? "method" : "function";
  if (/class/.test(nodeKind)) return "class";
  if (/interface|trait/.test(nodeKind)) return "interface";
  if (/type_alias|type_declaration|struct|enum/.test(nodeKind)) return "type";
  return null;
}

function extractAstData(runtime: AstRuntime, language: string, source: string, file: string): { symbols: SymbolRecord[]; imports: string[] } {
  const symbols: SymbolRecord[] = [];
  const imports: string[] = [];
  const root = runtime.parse(language, source).root();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const kind = node.kind();
    const mappedKind = symbolKind(kind);
    if (mappedKind) {
      const nameNode = node.field("name");
      const name = nameNode?.text().trim();
      if (name && name.length <= 200) {
        const firstLine = node.text().split(/\r?\n/, 1)[0]?.trim() ?? name;
        symbols.push({
          id: `${file}:${node.range().start.line + 1}:${name}`,
          file,
          name,
          kind: mappedKind,
          line: node.range().start.line + 1,
          signature: firstLine.slice(0, 300),
        });
      }
    }
    if (/import|export_statement|use_declaration/.test(kind)) {
      const text = node.text();
      const matches = text.matchAll(/["']([^"']+)["']|\b(?:from|use)\s+([A-Za-z0-9_:.\/\-]+)/g);
      for (const match of matches) imports.push(match[1] ?? match[2]);
    }
    stack.push(...node.children());
  }
  return { symbols, imports: [...new Set(imports.filter(Boolean))] };
}

function extractFallback(source: string, file: string): { symbols: SymbolRecord[]; imports: string[] } {
  const symbols = fallbackExtractSymbols(source, path.extname(file)).map((symbol) => ({
    id: `${file}:${symbol.line}:${symbol.name}`,
    file,
    name: symbol.name,
    kind: symbol.type,
    line: symbol.line,
    signature: symbol.signature,
  }));
  const imports = [...source.matchAll(/(?:from\s+|require\(|import[^"']*from\s*)["']([^"']+)["']/g)]
    .map((match) => match[1]);
  return { symbols, imports: [...new Set(imports)] };
}

function resolveImport(sourceFile: string, specifier: string, knownFiles: Set<string>): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), specifier)).replace(/\.(?:js|mjs|cjs)$/, "");
  const candidates = [base, ...[".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".java", ".rs"].map((ext) => base + ext), ...["index.ts", "index.tsx", "index.js", "__init__.py"].map((name) => `${base}/${name}`)];
  return candidates.find((candidate) => knownFiles.has(candidate)) ?? null;
}

function computeRanks(files: string[], edges: RepoEdge[]): Map<string, number> {
  const ranks = new Map(files.map((file) => [file, files.length > 0 ? 1 / files.length : 0]));
  const outbound = new Map<string, RepoEdge[]>();
  for (const edge of edges) outbound.set(edge.from, [...(outbound.get(edge.from) ?? []), edge]);
  for (let iteration = 0; iteration < 12; iteration++) {
    const next = new Map(files.map((file) => [file, files.length > 0 ? 0.15 / files.length : 0]));
    for (const file of files) {
      const links = outbound.get(file) ?? [];
      if (links.length === 0) continue;
      const totalWeight = links.reduce((sum, edge) => sum + edge.weight, 0);
      for (const edge of links) next.set(edge.to, (next.get(edge.to) ?? 0) + 0.85 * (ranks.get(file) ?? 0) * edge.weight / totalWeight);
    }
    for (const [file, rank] of next) ranks.set(file, rank);
  }
  return ranks;
}

export class RepoIndexService {
  private readonly workspaceDir: string;
  private readonly stateDir: string;
  private readonly cachePath: string;
  private snapshot: RepoIndexSnapshot | null = null;

  constructor(options: { workspaceDir: string; stateDir: string }) {
    this.workspaceDir = path.resolve(options.workspaceDir);
    this.stateDir = path.resolve(options.stateDir);
    const repositoryId = sha256(this.workspaceDir.toLowerCase()).slice(0, 24);
    this.cachePath = path.join(this.stateDir, "repo-index", `${repositoryId}.json`);
  }

  async build(): Promise<RepoIndexSnapshot> {
    const runtime = await loadAstRuntime();
    const previous = await this.readCache();
    const files = await this.walkFiles();
    const cache: RepoIndexCache = { parserVersion: PARSER_VERSION, files: {} };
    for (const absolute of files) {
      const relative = normalizeRelative(path.relative(this.workspaceDir, absolute));
      const old = previous?.parserVersion === PARSER_VERSION ? previous.files[relative] : undefined;
      const stat = await fs.stat(absolute);
      if (old?.mtimeMs === stat.mtimeMs && old.record.bytes === stat.size) {
        cache.files[relative] = old;
        continue;
      }
      const data = await fs.readFile(absolute);
      const contentHash = sha256(data);
      if (old?.record.contentHash === contentHash) {
        cache.files[relative] = { ...old, mtimeMs: stat.mtimeMs };
        continue;
      }
      const source = data.toString("utf8");
      const language = EXTENSIONS.get(path.extname(relative).toLowerCase());
      let extracted: { symbols: SymbolRecord[]; imports: string[] };
      try {
        extracted = runtime && language ? extractAstData(runtime, language, source, relative) : extractFallback(source, relative);
      } catch {
        extracted = extractFallback(source, relative);
      }
      cache.files[relative] = {
        record: { path: relative, bytes: data.byteLength, contentHash, language, rank: 0 },
        symbols: extracted.symbols,
        imports: extracted.imports,
        mtimeMs: stat.mtimeMs,
      };
    }
    const known = new Set(Object.keys(cache.files));
    const edges: RepoEdge[] = [];
    for (const [file, entry] of Object.entries(cache.files)) {
      for (const symbol of entry.symbols) edges.push({ from: file, to: symbol.id, kind: "defines", weight: 0.5 });
      for (const specifier of entry.imports) {
        const target = resolveImport(file, specifier, known);
        if (target) edges.push({ from: file, to: target, kind: "imports", weight: 1 });
      }
      if (/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|(?:\.test|\.spec)\./i.test(file)) {
        for (const edge of edges.filter((candidate) => candidate.from === file && candidate.kind === "imports")) {
          edges.push({ from: file, to: edge.to, kind: "tests", weight: 2 });
        }
      }
    }
    const ranks = computeRanks([...known], edges.filter((edge) => known.has(edge.to)));
    for (const entry of Object.values(cache.files)) entry.record.rank = ranks.get(entry.record.path) ?? 0;
    const revision = await this.gitValue(["rev-parse", "HEAD"], "unversioned");
    const dirtyFingerprint = sha256(Object.values(cache.files).sort((a, b) => a.record.path.localeCompare(b.record.path)).map((entry) => `${entry.record.path}:${entry.record.contentHash}`).join("\n"));
    const snapshot: RepoIndexSnapshot = {
      repositoryId: sha256(this.workspaceDir.toLowerCase()).slice(0, 24),
      revision,
      dirtyFingerprint,
      parserVersion: PARSER_VERSION,
      files: Object.values(cache.files).map((entry) => entry.record).sort((a, b) => a.path.localeCompare(b.path)),
      symbols: Object.values(cache.files).flatMap((entry) => entry.symbols),
      edges,
      generatedAt: Date.now(),
    };
    await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
    await fs.writeFile(this.cachePath, JSON.stringify(cache), "utf8");
    this.snapshot = snapshot;
    return structuredClone(snapshot);
  }

  async query(input: { query: string; limit?: number }): Promise<{ symbols: SymbolRecord[]; files: RepoFileRecord[]; snapshot: RepoIndexSnapshot }> {
    const snapshot = await this.build();
    const tokens = input.query.toLowerCase().split(/[^a-z0-9_.$/-]+/).filter(Boolean);
    const score = (value: string) => tokens.reduce((sum, token) => sum + (value.toLowerCase().includes(token) ? 1 : 0), 0);
    const limit = Math.max(1, Math.min(100, input.limit ?? 30));
    return {
      symbols: snapshot.symbols.map((symbol) => ({ symbol, score: score(`${symbol.name} ${symbol.signature} ${symbol.file}`) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || a.symbol.file.localeCompare(b.symbol.file)).slice(0, limit).map((entry) => entry.symbol),
      files: snapshot.files.map((file) => ({ file, score: score(file.path) + file.rank })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map((entry) => entry.file),
      snapshot,
    };
  }

  async impact(input: { symbol?: string; file?: string; limit?: number }): Promise<{ files: string[]; edges: RepoEdge[] }> {
    const snapshot = await this.build();
    const seeds = new Set<string>();
    if (input.file) seeds.add(normalizeRelative(input.file));
    if (input.symbol) for (const symbol of snapshot.symbols.filter((item) => item.name.toLowerCase().includes(input.symbol!.toLowerCase()))) seeds.add(symbol.file);
    const relevant = snapshot.edges.filter((edge) => seeds.has(edge.from) || seeds.has(edge.to));
    const files = [...new Set([...seeds, ...relevant.flatMap((edge) => [edge.from, edge.to]).filter((value) => snapshot.files.some((file) => file.path === value))])];
    return { files: files.slice(0, Math.max(1, input.limit ?? 40)), edges: relevant };
  }

  async renderMap(input: { mentioned?: string[]; tokenBudget?: number } = {}): Promise<RepoMapResult> {
    const snapshot = await this.build();
    const mentioned = (input.mentioned ?? []).map((value) => value.toLowerCase());
    const budget = Math.max(100, Math.min(3000, input.tokenBudget ?? (mentioned.length > 0 ? 1500 : 3000)));
    const byFile = new Map<string, SymbolRecord[]>();
    for (const symbol of snapshot.symbols) byFile.set(symbol.file, [...(byFile.get(symbol.file) ?? []), symbol]);
    const ranked = snapshot.files.map((file) => ({
      file,
      score: file.rank + (mentioned.some((term) => file.path.toLowerCase().includes(term) || (byFile.get(file.path) ?? []).some((symbol) => symbol.name.toLowerCase().includes(term))) ? 10 : 0),
    })).sort((a, b) => b.score - a.score || a.file.path.localeCompare(b.file.path));
    const lines: string[] = [];
    let estimatedTokens = 0;
    let truncated = false;
    for (const { file } of ranked) {
      const symbols = (byFile.get(file.path) ?? []).slice(0, 12);
      const block = [`${file.path} [${file.language ?? "text"}]`, ...symbols.map((symbol) => `  L${symbol.line} ${symbol.kind} ${symbol.signature}`)];
      const cost = Math.ceil(block.join("\n").length / 4);
      if (estimatedTokens + cost > budget) {
        truncated = true;
        continue;
      }
      lines.push(...block);
      estimatedTokens += cost;
    }
    return { text: lines.join("\n"), estimatedTokens, truncated, snapshot };
  }

  private async walkFiles(): Promise<string[]> {
    try {
      const listed = await execFileAsync(
        "git",
        ["ls-files", "-co", "--exclude-standard", "-z"],
        { cwd: this.workspaceDir, windowsHide: true, timeout: 10_000, maxBuffer: 20 * 1024 * 1024 }
      );
      const gitFiles: string[] = [];
      for (const relative of listed.stdout.split("\0").filter(Boolean)) {
        const normalized = normalizeRelative(relative);
        if (normalized.split("/").some((segment) => DEFAULT_IGNORES.has(segment.toLowerCase()))) continue;
        if (SECRET_NAMES.test(path.basename(normalized)) || !EXTENSIONS.has(path.extname(normalized).toLowerCase())) continue;
        const absolute = path.resolve(this.workspaceDir, relative);
        const escaped = path.relative(this.workspaceDir, absolute);
        if (escaped.startsWith("..") || path.isAbsolute(escaped)) continue;
        try {
          const stat = await fs.lstat(absolute);
          if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_FILE_BYTES) gitFiles.push(absolute);
        } catch { /* ignore races */ }
      }
      return [...new Set(gitFiles)].sort();
    } catch {
      // Non-Git workspace: fall back to a bounded filesystem walk.
    }
    const output: string[] = [];
    const stack = [this.workspaceDir];
    while (stack.length > 0) {
      const directory = stack.pop()!;
      let entries: Dirent[];
      try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (entry.isSymbolicLink() || DEFAULT_IGNORES.has(entry.name.toLowerCase())) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) { stack.push(absolute); continue; }
        if (!entry.isFile() || SECRET_NAMES.test(entry.name) || !EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        try {
          const stat = await fs.stat(absolute);
          if (stat.size <= MAX_FILE_BYTES) output.push(absolute);
        } catch { /* ignore files that disappear during indexing */ }
      }
    }
    return output.sort();
  }

  private async readCache(): Promise<RepoIndexCache | null> {
    try { return JSON.parse(await fs.readFile(this.cachePath, "utf8")) as RepoIndexCache; } catch { return null; }
  }

  private async gitValue(args: string[], fallback: string): Promise<string> {
    try { return (await execFileAsync("git", args, { cwd: this.workspaceDir, windowsHide: true, timeout: 5000 })).stdout.trim() || fallback; } catch { return fallback; }
  }
}
