import { access, readFile } from "fs/promises";
import { join, dirname } from "path";
import Database from "better-sqlite3";
import type { PersistedEntry } from "./types.js";

const DEFAULT_MEMORY_COUNT = 10;
const MAX_MEMORY_COUNT = 50;

function getMemoryDir(stateDir: string): string {
  const normalized = stateDir.replace(/\\/g, "/");
  if (
    normalized.includes("/memory/workspace") ||
    normalized.includes("/memory/global") ||
    normalized.endsWith("/memory")
  ) {
    return stateDir;
  }
  return join(stateDir, "memory");
}

function getRuntimeRootDir(stateDir: string, memoryDir: string): string {
  if (memoryDir !== stateDir) {
    return stateDir;
  }
  const normalized = stateDir.replace(/\\/g, "/");
  if (normalized.includes("/memory/workspace/")) {
    return dirname(dirname(dirname(stateDir)));
  }
  if (normalized.includes("/memory/global")) {
    return dirname(dirname(stateDir));
  }
  if (normalized.endsWith("/memory")) {
    return dirname(stateDir);
  }
  return stateDir;
}

export interface CognitiveIndexCounts {
  embeddings: number | null;
  kgNodes: number | null;
  kgEdges: number | null;
  distilledPractices: number | null;
}

export interface LocalMemoryReportEntry extends PersistedEntry {
  createdAtIso: string;
  preview: string;
}

export interface LocalMemorySearchEntry extends LocalMemoryReportEntry {
  score: number;
  matchedVia: string[];
}

export interface LocalMemoryPracticeEntry {
  id: string;
  taskPattern: string;
  confidence: number;
  hitCount: number;
  createdAt: number;
  createdAtIso: string;
  actionCount: number;
  actionPreview: string;
  contextCount: number;
  contextPreview: string;
}

export interface LocalMemoryGraphNode {
  id: string;
  type: string;
  label: string;
  lastSeen: number;
  lastSeenIso: string;
  outgoing: number;
  incoming: number;
  degree: number;
  relationPreview: string;
}

export interface LocalMemoryReport {
  stateDir: string;
  memoryDir: string;
  memoryFile: string;
  cognitiveIndexDb: string;
  entries: LocalMemoryReportEntry[];
  totalEntries: number;
  requestedCount: number;
  truncated: boolean;
  cognitiveIndex: CognitiveIndexCounts;
  warnings: string[];
}

export interface LocalMemorySourceEntry {
  id: string;
  label: string;
  path: string;
  exists: boolean;
  role: string;
  boundary: string;
}

export interface LocalMemorySourcesReport {
  stateDir: string;
  sources: LocalMemorySourceEntry[];
}

export interface LocalMemoryReportOptions {
  count?: string | number;
}

export interface LocalMemorySearchRequest {
  query?: string;
  count?: string | number;
}

export interface LocalMemorySearchReport {
  stateDir: string;
  memoryDir: string;
  memoryFile: string;
  query: string;
  entries: LocalMemorySearchEntry[];
  totalEntries: number;
  totalMatches: number;
  requestedCount: number;
  truncated: boolean;
  warnings: string[];
}

export interface LocalMemoryPracticesReport {
  stateDir: string;
  memoryDir: string;
  cognitiveIndexDb: string;
  entries: LocalMemoryPracticeEntry[];
  totalPractices: number;
  requestedCount: number;
  truncated: boolean;
  warnings: string[];
}

export interface LocalMemoryGraphReport {
  stateDir: string;
  memoryDir: string;
  cognitiveIndexDb: string;
  entries: LocalMemoryGraphNode[];
  totalNodes: number;
  totalEdges: number;
  requestedCount: number;
  truncated: boolean;
  warnings: string[];
}

export function parseMemoryReportCount(value?: string | number): number {
  if (value === undefined || value === null || value === "") return DEFAULT_MEMORY_COUNT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MEMORY_COUNT;
  return Math.min(Math.floor(parsed), MAX_MEMORY_COUNT);
}

export function parseMemorySearchArgs(args: string[]): { query: string; count: number } {
  const trimmed = args.map((arg) => String(arg).trim()).filter(Boolean);
  if (!trimmed.length) return { query: "", count: DEFAULT_MEMORY_COUNT };
  const last = trimmed[trimmed.length - 1];
  const lastIsNumeric = /^-?\d+(?:\.\d+)?$/.test(last);
  const count = lastIsNumeric ? parseMemoryReportCount(last) : DEFAULT_MEMORY_COUNT;
  const queryParts = lastIsNumeric ? trimmed.slice(0, -1) : trimmed;
  return {
    query: queryParts.join(" ").trim(),
    count,
  };
}

function emptyCounts(): CognitiveIndexCounts {
  return {
    embeddings: null,
    kgNodes: null,
    kgEdges: null,
    distilledPractices: null,
  };
}

function formatCreatedAt(value: unknown): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "-";
  const date = new Date(numeric);
  return Number.isNaN(date.getTime()) ? "-" : date.toISOString();
}

function normalizePreview(content: string, maxLength = 140): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1)}…`;
}

function normalizeEntry(value: unknown): PersistedEntry | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id.trim()) return null;
  if (typeof raw.content !== "string") return null;
  return {
    id: raw.id,
    content: raw.content,
    source: typeof raw.source === "string" ? raw.source : "unknown",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Number(raw.createdAt) || 0,
    importance: typeof raw.importance === "number" ? raw.importance : Number(raw.importance) || 0,
  };
}

async function loadPersistedEntries(memoryFile: string, warnings: string[]): Promise<PersistedEntry[]> {
  try {
    const raw = await readFile(memoryFile, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { entries?: unknown }).entries)
        ? (parsed as { entries: unknown[] }).entries
        : [];
    return values.map(normalizeEntry).filter((entry): entry is PersistedEntry => entry !== null);
  } catch (error) {
    const code = error && typeof error === "object" ? (error as NodeJS.ErrnoException).code : undefined;
    if (code !== "ENOENT") {
      warnings.push(`memory.json unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
    return [];
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function countTable(db: Database.Database, table: string): number | null {
  const tableRow = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { name?: string } | undefined;
  if (!tableRow?.name) return null;
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

function hasTable(db: Database.Database, table: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(table) as { name?: string } | undefined;
  return Boolean(row?.name);
}

async function readCognitiveIndexCounts(dbPath: string, warnings: string[]): Promise<CognitiveIndexCounts> {
  if (!(await exists(dbPath))) return emptyCounts();

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    return {
      embeddings: countTable(db, "embeddings"),
      kgNodes: countTable(db, "kg_nodes"),
      kgEdges: countTable(db, "kg_edges"),
      distilledPractices: countTable(db, "distilled_practices"),
    };
  } catch (error) {
    warnings.push(`cognitive_knowledge.db unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return emptyCounts();
  } finally {
    db?.close();
  }
}

function sortEntries(entries: PersistedEntry[]): PersistedEntry[] {
  return [...entries].sort((left, right) => {
    const timeDelta = right.createdAt - left.createdAt;
    if (timeDelta !== 0) return timeDelta;
    const importanceDelta = right.importance - left.importance;
    if (importanceDelta !== 0) return importanceDelta;
    return left.id.localeCompare(right.id);
  });
}

function toReportEntry(entry: PersistedEntry): LocalMemoryReportEntry {
  return {
    ...entry,
    createdAtIso: formatCreatedAt(entry.createdAt),
    preview: normalizePreview(entry.content),
  };
}

function valueToPreview(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function summarizeJsonField(raw: string, id: string, label: string, warnings: string[]): { count: number; preview: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { files?: unknown[] }).files)
        ? (parsed as { files: unknown[] }).files
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { commands?: unknown[] }).commands)
          ? (parsed as { commands: unknown[] }).commands
          : [parsed];
    const previewItems = values.map(valueToPreview).filter(Boolean);
    return {
      count: previewItems.length,
      preview: previewItems.slice(0, 3).join(" | ") || "-",
    };
  } catch (error) {
    warnings.push(`${id} ${label} json unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return {
      count: raw ? 1 : 0,
      preview: raw || "-",
    };
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function tokenizeQuery(query: string): string[] {
  return unique(query.toLowerCase().split(/\s+/).map((token) => token.trim()).filter(Boolean));
}

function matchEntry(entry: PersistedEntry, query: string): { score: number; matchedVia: string[] } | null {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return null;

  const content = entry.content.toLowerCase();
  const source = entry.source.toLowerCase();
  const id = entry.id.toLowerCase();
  const tokens = tokenizeQuery(normalizedQuery);
  let score = 0;
  const matchedVia: string[] = [];

  if (content.includes(normalizedQuery)) {
    score += 10;
    matchedVia.push("content:phrase");
  }

  for (const token of tokens) {
    if (content.includes(token)) {
      score += 5;
      matchedVia.push(`content:${token}`);
    }
    if (source.includes(token)) {
      score += 3;
      matchedVia.push(`source:${token}`);
    }
    if (id.includes(token)) {
      score += 2;
      matchedVia.push(`id:${token}`);
    }
  }

  if (!matchedVia.length) return null;
  return { score, matchedVia: unique(matchedVia) };
}

export async function buildLocalMemoryReport(
  stateDir: string,
  options: LocalMemoryReportOptions = {}
): Promise<LocalMemoryReport> {
  const requestedCount = parseMemoryReportCount(options.count);
  const memoryDir = getMemoryDir(stateDir);
  const memoryFile = join(memoryDir, "memory.json");
  const cognitiveIndexDb = join(memoryDir, "cognitive_knowledge.db");
  const warnings: string[] = [];
  const entries = sortEntries(await loadPersistedEntries(memoryFile, warnings));
  const cognitiveIndex = await readCognitiveIndexCounts(cognitiveIndexDb, warnings);

  return {
    stateDir,
    memoryDir,
    memoryFile,
    cognitiveIndexDb,
    entries: entries.slice(0, requestedCount).map(toReportEntry),
    totalEntries: entries.length,
    requestedCount,
    truncated: entries.length > requestedCount,
    cognitiveIndex,
    warnings,
  };
}

export async function buildLocalMemorySourcesReport(stateDir: string): Promise<LocalMemorySourcesReport> {
  const memoryDir = getMemoryDir(stateDir);
  const runtimeRootDir = getRuntimeRootDir(stateDir, memoryDir);
  const sourceSpecs = [
    {
      id: "persisted_memory",
      label: "Persisted memory",
      path: join(memoryDir, "memory.json"),
      role: "context recall",
      boundary: "条目内容可被显式列表、搜索和详情审计；本报告只检查文件存在性。",
    },
    {
      id: "cognitive_index",
      label: "Cognitive index",
      path: join(memoryDir, "cognitive_knowledge.db"),
      role: "context recall metadata",
      boundary: "只用于向量、知识图谱和蒸馏实践索引；本报告不打开数据库。",
    },
    {
      id: "legacy_flat_memory",
      label: "Legacy flat memory",
      path: join(runtimeRootDir, "memory", "memory.json"),
      role: "legacy migration source",
      boundary: "旧版扁平记忆不会自动跨项目迁移；本报告只检查文件存在性。",
    },
    {
      id: "session_checkpoints",
      label: "Session checkpoints",
      path: join(runtimeRootDir, "sessions"),
      role: "resume metadata",
      boundary: "用于会话恢复和 checkpoint；本报告不读取 session 正文。",
    },
    {
      id: "goal_task_state",
      label: "Goal and task state",
      path: runtimeRootDir,
      role: "task progress metadata",
      boundary: "goal/task 进度保存在 session-goals、session-tasks 等本地文件；本报告不读取任务正文。",
    },
  ];

  const sources = await Promise.all(sourceSpecs.map(async (source): Promise<LocalMemorySourceEntry> => ({
    ...source,
    exists: await exists(source.path),
  })));

  return { stateDir, sources };
}

export async function searchLocalMemoryEntries(
  stateDir: string,
  request: LocalMemorySearchRequest
): Promise<LocalMemorySearchReport> {
  const requestedCount = parseMemoryReportCount(request.count);
  const query = (request.query ?? "").trim();
  const memoryDir = getMemoryDir(stateDir);
  const memoryFile = join(memoryDir, "memory.json");
  const warnings: string[] = [];
  const entries = await loadPersistedEntries(memoryFile, warnings);

  const matches = query
    ? entries.flatMap((entry): LocalMemorySearchEntry[] => {
      const match = matchEntry(entry, query);
      if (!match) return [];
      return [{ ...toReportEntry(entry), ...match }];
    })
    : [];

  matches.sort((left, right) => {
    const scoreDelta = right.score - left.score;
    if (scoreDelta !== 0) return scoreDelta;
    const importanceDelta = right.importance - left.importance;
    if (importanceDelta !== 0) return importanceDelta;
    const timeDelta = right.createdAt - left.createdAt;
    if (timeDelta !== 0) return timeDelta;
    return left.id.localeCompare(right.id);
  });

  return {
    stateDir,
    memoryDir,
    memoryFile,
    query,
    entries: matches.slice(0, requestedCount),
    totalEntries: entries.length,
    totalMatches: matches.length,
    requestedCount,
    truncated: matches.length > requestedCount,
    warnings,
  };
}

export async function listLocalMemoryPractices(
  stateDir: string,
  options: LocalMemoryReportOptions = {}
): Promise<LocalMemoryPracticesReport> {
  const requestedCount = parseMemoryReportCount(options.count);
  const memoryDir = getMemoryDir(stateDir);
  const cognitiveIndexDb = join(memoryDir, "cognitive_knowledge.db");
  const warnings: string[] = [];

  if (!(await exists(cognitiveIndexDb))) {
    return {
      stateDir,
      memoryDir,
      cognitiveIndexDb,
      entries: [],
      totalPractices: 0,
      requestedCount,
      truncated: false,
      warnings,
    };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(cognitiveIndexDb, { readonly: true, fileMustExist: true });
    if (!hasTable(db, "distilled_practices")) {
      return {
        stateDir,
        memoryDir,
        cognitiveIndexDb,
        entries: [],
        totalPractices: 0,
        requestedCount,
        truncated: false,
        warnings,
      };
    }

    const rows = db
      .prepare(`
        SELECT id, task_pattern, action_json, context_json, confidence, hit_count, created_at
        FROM distilled_practices
        ORDER BY confidence DESC, hit_count DESC, created_at DESC, id ASC
      `)
      .all() as Array<{
        id: string;
        task_pattern: string;
        action_json: string;
        context_json: string;
        confidence: number;
        hit_count: number;
        created_at: number;
      }>;

    const entries = rows.map((row): LocalMemoryPracticeEntry => {
      const action = summarizeJsonField(String(row.action_json ?? ""), row.id, "action_json", warnings);
      const context = summarizeJsonField(String(row.context_json ?? ""), row.id, "context_json", warnings);
      return {
        id: String(row.id),
        taskPattern: String(row.task_pattern ?? ""),
        confidence: Number(row.confidence ?? 0),
        hitCount: Number(row.hit_count ?? 0),
        createdAt: Number(row.created_at ?? 0),
        createdAtIso: formatCreatedAt(Number(row.created_at ?? 0)),
        actionCount: action.count,
        actionPreview: action.preview,
        contextCount: context.count,
        contextPreview: context.preview,
      };
    });

    return {
      stateDir,
      memoryDir,
      cognitiveIndexDb,
      entries: entries.slice(0, requestedCount),
      totalPractices: entries.length,
      requestedCount,
      truncated: entries.length > requestedCount,
      warnings,
    };
  } catch (error) {
    warnings.push(`cognitive_knowledge.db unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return {
      stateDir,
      memoryDir,
      cognitiveIndexDb,
      entries: [],
      totalPractices: 0,
      requestedCount,
      truncated: false,
      warnings,
    };
  } finally {
    db?.close();
  }
}

interface KnowledgeGraphNodeRow {
  id: string;
  type: string;
  label: string;
  last_seen: number;
}

interface KnowledgeGraphEdgeRow {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

function emptyGraphReport(
  stateDir: string,
  memoryDir: string,
  cognitiveIndexDb: string,
  requestedCount: number,
  warnings: string[] = []
): LocalMemoryGraphReport {
  return {
    stateDir,
    memoryDir,
    cognitiveIndexDb,
    entries: [],
    totalNodes: 0,
    totalEdges: 0,
    requestedCount,
    truncated: false,
    warnings,
  };
}

function relationLabelForNode(
  nodeId: string,
  edge: KnowledgeGraphEdgeRow,
  nodesById: Map<string, KnowledgeGraphNodeRow>
): string {
  if (edge.source === nodeId) {
    const target = nodesById.get(edge.target);
    return `${edge.relation} -> ${target?.label || edge.target}`;
  }
  const source = nodesById.get(edge.source);
  return `${edge.relation} <- ${source?.label || edge.source}`;
}

export async function listLocalMemoryGraph(
  stateDir: string,
  options: LocalMemoryReportOptions = {}
): Promise<LocalMemoryGraphReport> {
  const requestedCount = parseMemoryReportCount(options.count);
  const memoryDir = getMemoryDir(stateDir);
  const cognitiveIndexDb = join(memoryDir, "cognitive_knowledge.db");
  const warnings: string[] = [];

  if (!(await exists(cognitiveIndexDb))) {
    return emptyGraphReport(stateDir, memoryDir, cognitiveIndexDb, requestedCount, warnings);
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(cognitiveIndexDb, { readonly: true, fileMustExist: true });
    if (!hasTable(db, "kg_nodes") || !hasTable(db, "kg_edges")) {
      return emptyGraphReport(stateDir, memoryDir, cognitiveIndexDb, requestedCount, warnings);
    }

    const nodes = db
      .prepare("SELECT id, type, label, last_seen FROM kg_nodes")
      .all() as KnowledgeGraphNodeRow[];
    const edges = db
      .prepare("SELECT source, target, relation, weight FROM kg_edges")
      .all() as KnowledgeGraphEdgeRow[];
    const nodesById = new Map(nodes.map((node) => [String(node.id), node]));
    const edgesByNode = new Map<string, KnowledgeGraphEdgeRow[]>();

    for (const edge of edges) {
      const source = String(edge.source);
      const target = String(edge.target);
      edgesByNode.set(source, [...(edgesByNode.get(source) ?? []), edge]);
      edgesByNode.set(target, [...(edgesByNode.get(target) ?? []), edge]);
    }

    const entries = nodes.map((node): LocalMemoryGraphNode => {
      const id = String(node.id);
      const relatedEdges = edgesByNode.get(id) ?? [];
      const outgoing = relatedEdges.filter((edge) => String(edge.source) === id).length;
      const incoming = relatedEdges.filter((edge) => String(edge.target) === id).length;
      const preview = relatedEdges
        .map((edge) => relationLabelForNode(id, edge, nodesById))
        .slice(0, 3)
        .join(" | ");
      const lastSeen = Number(node.last_seen ?? 0);
      return {
        id,
        type: String(node.type ?? "unknown"),
        label: String(node.label ?? id),
        lastSeen,
        lastSeenIso: formatCreatedAt(lastSeen),
        outgoing,
        incoming,
        degree: outgoing + incoming,
        relationPreview: preview || "-",
      };
    });

    entries.sort((left, right) => {
      const timeDelta = right.lastSeen - left.lastSeen;
      if (timeDelta !== 0) return timeDelta;
      const degreeDelta = right.degree - left.degree;
      if (degreeDelta !== 0) return degreeDelta;
      return left.id.localeCompare(right.id);
    });

    return {
      stateDir,
      memoryDir,
      cognitiveIndexDb,
      entries: entries.slice(0, requestedCount),
      totalNodes: entries.length,
      totalEdges: edges.length,
      requestedCount,
      truncated: entries.length > requestedCount,
      warnings,
    };
  } catch (error) {
    warnings.push(`cognitive_knowledge.db unreadable: ${error instanceof Error ? error.message : String(error)}`);
    return emptyGraphReport(stateDir, memoryDir, cognitiveIndexDb, requestedCount, warnings);
  } finally {
    db?.close();
  }
}

export async function findLocalMemoryEntry(stateDir: string, id: string): Promise<LocalMemoryReportEntry | null> {
  const memoryDir = getMemoryDir(stateDir);
  const memoryFile = join(memoryDir, "memory.json");
  const entries = sortEntries(await loadPersistedEntries(memoryFile, []));
  const found = entries.find((entry) => entry.id === id);
  return found ? toReportEntry(found) : null;
}

function formatCount(value: number | null): string {
  return value === null ? "unavailable" : String(value);
}

export function formatLocalMemoryReport(report: LocalMemoryReport): string[] {
  const lines = [
    "",
    "🧠 本地记忆",
    "-----------------------------------------",
    `State dir : ${report.stateDir}`,
    `Memory   : ${report.memoryFile}`,
    `Entries  : ${report.entries.length}/${report.totalEntries}`,
    `Index    : embeddings=${formatCount(report.cognitiveIndex.embeddings)} kg_nodes=${formatCount(report.cognitiveIndex.kgNodes)} kg_edges=${formatCount(report.cognitiveIndex.kgEdges)} distilled_practices=${formatCount(report.cognitiveIndex.distilledPractices)}`,
  ];

  if (report.truncated) {
    lines.push(`Limit    : 显示最近 ${report.requestedCount} 条`);
  }

  for (const warning of report.warnings) {
    lines.push(`Warning  : ${warning}`);
  }

  if (!report.entries.length) {
    lines.push("Status   : 暂无本地持久化记忆；继续使用轻灵后会自动沉淀，或使用现有 memory 能力写入。");
    lines.push("-----------------------------------------");
    lines.push("说明     : 只读取本地 memory.json 与索引表计数，不读取会话正文、不调用模型、不联网。");
    lines.push("");
    return lines;
  }

  lines.push("");
  report.entries.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.id}`);
    lines.push(`   来源     : ${entry.source}`);
    lines.push(`   创建时间 : ${entry.createdAtIso}`);
    lines.push(`   重要度   : ${entry.importance}`);
    lines.push(`   预览     : ${entry.preview}`);
  });
  lines.push("-----------------------------------------");
  lines.push("说明     : 列表只读取本地持久化记忆与索引元数据；用 /memory show <id> 审计单条内容。");
  lines.push("");
  return lines;
}

export function formatLocalMemorySourcesReport(report: LocalMemorySourcesReport): string[] {
  const lines = [
    "",
    "🧭 本地记忆来源",
    "-----------------------------------------",
    `State dir : ${report.stateDir}`,
    "",
  ];

  report.sources.forEach((source, index) => {
    lines.push(`${index + 1}. ${source.id}`);
    lines.push(`   名称     : ${source.label}`);
    lines.push(`   路径     : ${source.path}`);
    lines.push(`   状态     : ${source.exists ? "exists" : "missing"}`);
    lines.push(`   角色     : ${source.role}`);
    lines.push(`   边界     : ${source.boundary}`);
  });

  lines.push("-----------------------------------------");
  lines.push("说明     : 只读检查本地来源路径是否存在；不读取 session 正文、不调用模型、不联网。");
  lines.push("");
  return lines;
}

export function formatLocalMemorySearchReport(report: LocalMemorySearchReport): string[] {
  const lines = [
    "",
    "🔎 本地记忆搜索",
    "-----------------------------------------",
    `Query    : ${report.query || "(empty)"}`,
    `Memory   : ${report.memoryFile}`,
    `Matches  : ${report.entries.length}/${report.totalMatches}`,
    `Entries  : ${report.totalEntries}`,
  ];

  if (report.truncated) {
    lines.push(`Limit    : 显示前 ${report.requestedCount} 条`);
  }
  for (const warning of report.warnings) {
    lines.push(`Warning  : ${warning}`);
  }

  if (!report.query) {
    lines.push("Status   : 请输入搜索词。用法: /memory search <query> [count]");
    lines.push("-----------------------------------------");
    lines.push("说明     : 只读取本地 memory.json，不读取会话正文、不调用模型、不联网。");
    lines.push("");
    return lines;
  }

  if (!report.entries.length) {
    lines.push("Status   : 无本地匹配。");
    lines.push("-----------------------------------------");
    lines.push("说明     : 只读取本地 memory.json，不读取会话正文、不调用模型、不联网。");
    lines.push("");
    return lines;
  }

  lines.push("");
  report.entries.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.id}`);
    lines.push(`   Source    : ${entry.source}`);
    lines.push(`   Created   : ${entry.createdAtIso}`);
    lines.push(`   Importance: ${entry.importance}`);
    lines.push(`   Matched via: ${entry.matchedVia.join(", ")}`);
    lines.push(`   Preview   : ${entry.preview}`);
  });
  lines.push("-----------------------------------------");
  lines.push("说明     : 搜索只输出本地记忆预览和匹配路径；用 /memory show <id> 审计完整内容。");
  lines.push("");
  return lines;
}

export function formatLocalMemoryPracticesReport(report: LocalMemoryPracticesReport): string[] {
  const lines = [
    "",
    "🧪 本地蒸馏实践",
    "-----------------------------------------",
    `DB       : ${report.cognitiveIndexDb}`,
    `Count    : ${report.entries.length}/${report.totalPractices}`,
  ];

  if (report.truncated) {
    lines.push(`Limit    : 显示前 ${report.requestedCount} 条`);
  }
  for (const warning of report.warnings) {
    lines.push(`Warning  : ${warning}`);
  }

  if (!report.entries.length) {
    lines.push("Status   : 暂无本地蒸馏实践。");
    lines.push("-----------------------------------------");
    lines.push("说明     : 只读取本地 cognitive_knowledge.db 的 distilled_practices 表，不读取会话正文、不调用模型、不联网。");
    lines.push("");
    return lines;
  }

  lines.push("");
  report.entries.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.id}`);
    lines.push(`   任务模式 : ${entry.taskPattern}`);
    lines.push(`   置信度   : ${entry.confidence}`);
    lines.push(`   命中次数 : ${entry.hitCount}`);
    lines.push(`   创建时间 : ${entry.createdAtIso}`);
    lines.push(`   动作预览 : (${entry.actionCount}) ${entry.actionPreview}`);
    lines.push(`   上下文   : (${entry.contextCount}) ${entry.contextPreview}`);
  });
  lines.push("-----------------------------------------");
  lines.push("说明     : 只读展示本地成功实践摘要；不读取 session 正文、不写入索引。");
  lines.push("");
  return lines;
}

export function formatLocalMemoryGraphReport(report: LocalMemoryGraphReport): string[] {
  const lines = [
    "",
    "🕸️ 本地知识图谱",
    "-----------------------------------------",
    `DB       : ${report.cognitiveIndexDb}`,
    `Nodes    : ${report.entries.length}/${report.totalNodes}`,
    `Edges    : ${report.totalEdges}`,
  ];

  if (report.truncated) {
    lines.push(`Limit    : 显示前 ${report.requestedCount} 个节点`);
  }
  for (const warning of report.warnings) {
    lines.push(`Warning  : ${warning}`);
  }

  if (!report.entries.length) {
    lines.push("Status   : 暂无本地知识图谱；继续使用轻灵后会自动沉淀命令、文件与任务关联。");
    lines.push("-----------------------------------------");
    lines.push("说明     : 只读取本地 cognitive_knowledge.db 的 kg_nodes/kg_edges 元数据，不读取会话正文、不调用模型、不联网。");
    lines.push("");
    return lines;
  }

  lines.push("");
  report.entries.forEach((entry, index) => {
    lines.push(`${index + 1}. ${entry.id}`);
    lines.push(`   类型     : ${entry.type}`);
    lines.push(`   标签     : ${entry.label}`);
    lines.push(`   最后出现 : ${entry.lastSeenIso}`);
    lines.push(`   连接度   : ${entry.degree} (out=${entry.outgoing}, in=${entry.incoming})`);
    lines.push(`   关系预览 : ${entry.relationPreview}`);
  });
  lines.push("-----------------------------------------");
  lines.push("说明     : 只读展示本地知识图谱节点与关系摘要；不读取 metadata、session 正文、不写入索引。");
  lines.push("");
  return lines;
}

export function formatLocalMemoryEntry(entry: LocalMemoryReportEntry | null): string[] {
  if (!entry) {
    return ["未找到指定本地记忆。"];
  }
  return [
    "",
    "🧠 本地记忆详情",
    "-----------------------------------------",
    `ID       : ${entry.id}`,
    `Source   : ${entry.source}`,
    `Created  : ${entry.createdAtIso}`,
    `Importance: ${entry.importance}`,
    "",
    entry.content,
    "-----------------------------------------",
    "说明     : 只读取本地 memory.json 中的指定条目，不读取会话正文、不调用模型、不联网。",
    "",
  ];
}
