// ============================================================
// Phase 4.3 — 可选 TypeScript LanguageService（进程内，非 stdio LSP）
// 启用：QLING_LSP=1；依赖可选 peer/dev 的 typescript 包
// ============================================================

import { readFileSync, existsSync, statSync } from "fs";
import { relative, resolve, extname } from "path";

export type TsModule = typeof import("typescript");

export interface LspLocation {
  file: string;
  line: number; // 1-based
  character: number; // 1-based
  preview?: string;
}

export interface LspHoverResult {
  display: string;
  documentation: string;
}

export interface LspSymbolItem {
  name: string;
  kind: string;
  line: number;
  character: number;
}

export function isLspEnabled(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): boolean {
  const raw = String(env.QLING_LSP ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes";
}

export async function loadTypeScript(): Promise<TsModule | null> {
  try {
    const mod = await import("typescript");
    return (mod as { default?: TsModule }).default ?? (mod as TsModule);
  } catch {
    return null;
  }
}

function isTsLike(file: string): boolean {
  const ext = extname(file).toLowerCase();
  return [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"].includes(ext);
}

function lineCharToPos(ts: TsModule, content: string, line: number, character: number): number {
  // line/character 1-based for agent UX
  const l = Math.max(1, line) - 1;
  const c = Math.max(1, character) - 1;
  return ts.getPositionOfLineAndCharacter(
    ts.createSourceFile("tmp.ts", content, ts.ScriptTarget.Latest, true),
    l,
    c
  );
}

function posToLineChar(
  ts: TsModule,
  content: string,
  pos: number
): { line: number; character: number } {
  const sf = ts.createSourceFile("tmp.ts", content, ts.ScriptTarget.Latest, true);
  const lc = ts.getLineAndCharacterOfPosition(sf, pos);
  return { line: lc.line + 1, character: lc.character + 1 };
}

interface ServiceBundle {
  ts: TsModule;
  service: import("typescript").LanguageService;
  workspaceDir: string;
  dispose: () => void;
}

const cache = new Map<string, ServiceBundle>();

function createLanguageService(ts: TsModule, workspaceDir: string): ServiceBundle {
  const root = resolve(workspaceDir);
  const configPath = ts.findConfigFile(root, ts.sys.fileExists.bind(ts.sys), "tsconfig.json");

  let options: import("typescript").CompilerOptions = {
    allowJs: true,
    checkJs: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.ReactJSX,
    skipLibCheck: true,
    esModuleInterop: true,
  };
  let rootFileNames: string[] = [];

  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile.bind(ts.sys));
    const parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      resolve(configPath, "..")
    );
    options = parsed.options;
    rootFileNames = parsed.fileNames;
  }

  const fileExists = (f: string) => existsSync(f);
  const readFile = (f: string) => {
    try {
      return readFileSync(f, "utf8");
    } catch {
      return undefined;
    }
  };

  // 确保打开的文件在 project 中
  const extraFiles = new Set<string>();

  const host: import("typescript").LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => {
      const set = new Set(rootFileNames);
      for (const f of extraFiles) set.add(f);
      return Array.from(set);
    },
    getScriptVersion: (fileName) => {
      try {
        const stat = statSync(fileName);
        return `${stat.mtimeMs}:${stat.size}`;
      } catch {
        return "0";
      }
    },
    getScriptSnapshot: (fileName) => {
      const text = readFile(fileName);
      if (text === undefined) return undefined;
      return ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists,
    readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  return {
    ts,
    service,
    workspaceDir: root,
    dispose: () => {
      service.dispose();
      cache.delete(root);
    },
  };
}

export function getTsService(
  ts: TsModule,
  workspaceDir: string
): ServiceBundle {
  const root = resolve(workspaceDir);
  let bundle = cache.get(root);
  if (!bundle) {
    bundle = createLanguageService(ts, root);
    cache.set(root, bundle);
  }
  return bundle;
}

export function resetTsServiceCache(): void {
  for (const b of cache.values()) {
    try {
      b.service.dispose();
    } catch {
      // ignore
    }
  }
  cache.clear();
}

function rel(workspaceDir: string, abs: string): string {
  const r = relative(workspaceDir, abs).replace(/\\/g, "/");
  return r || abs;
}

export function lspDefinition(
  bundle: ServiceBundle,
  absFile: string,
  line: number,
  character: number
): LspLocation[] {
  const { ts, service, workspaceDir } = bundle;
  if (!isTsLike(absFile) || !existsSync(absFile)) return [];
  const content = readFileSync(absFile, "utf8");
  const pos = lineCharToPos(ts, content, line, character);
  const defs = service.getDefinitionAtPosition(absFile, pos) ?? [];
  return defs.map((d) => {
    const fileText = existsSync(d.fileName) ? readFileSync(d.fileName, "utf8") : "";
    const lc = fileText
      ? posToLineChar(ts, fileText, d.textSpan.start)
      : { line: 1, character: 1 };
    const preview = fileText
      ? fileText.slice(d.textSpan.start, d.textSpan.start + Math.min(d.textSpan.length, 120))
      : undefined;
    return {
      file: rel(workspaceDir, d.fileName),
      line: lc.line,
      character: lc.character,
      preview: preview?.replace(/\s+/g, " ").trim(),
    };
  });
}

export function lspHover(
  bundle: ServiceBundle,
  absFile: string,
  line: number,
  character: number
): LspHoverResult | null {
  const { ts, service } = bundle;
  if (!isTsLike(absFile) || !existsSync(absFile)) return null;
  const content = readFileSync(absFile, "utf8");
  const pos = lineCharToPos(ts, content, line, character);
  const info = service.getQuickInfoAtPosition(absFile, pos);
  if (!info) return null;
  const display = ts.displayPartsToString(info.displayParts ?? []);
  const documentation = ts.displayPartsToString(info.documentation ?? []);
  return { display, documentation };
}

export function lspReferences(
  bundle: ServiceBundle,
  absFile: string,
  line: number,
  character: number,
  limit = 30
): LspLocation[] {
  const { ts, service, workspaceDir } = bundle;
  if (!isTsLike(absFile) || !existsSync(absFile)) return [];
  const content = readFileSync(absFile, "utf8");
  const pos = lineCharToPos(ts, content, line, character);
  const refs =
    service.findReferences(absFile, pos)?.flatMap((r) => r.references) ?? [];
  return refs.slice(0, limit).map((ref) => {
    const fileText = existsSync(ref.fileName) ? readFileSync(ref.fileName, "utf8") : "";
    const lc = fileText
      ? posToLineChar(ts, fileText, ref.textSpan.start)
      : { line: 1, character: 1 };
    return {
      file: rel(workspaceDir, ref.fileName),
      line: lc.line,
      character: lc.character,
    };
  });
}

export function lspDocumentSymbols(
  bundle: ServiceBundle,
  absFile: string,
  limit = 80
): LspSymbolItem[] {
  const { ts, service } = bundle;
  if (!isTsLike(absFile) || !existsSync(absFile)) return [];
  const nav = service.getNavigationBarItems(absFile);
  const out: LspSymbolItem[] = [];

  const walk = (items: import("typescript").NavigationBarItem[], depth = 0) => {
    for (const item of items) {
      if (out.length >= limit) return;
      const span = item.spans[0];
      if (span) {
        const content = readFileSync(absFile, "utf8");
        const lc = posToLineChar(ts, content, span.start);
        out.push({
          name: item.text,
          kind: String(item.kind),
          line: lc.line,
          character: lc.character,
        });
      }
      if (item.childItems?.length) walk(item.childItems, depth + 1);
    }
  };
  walk(nav);
  return out;
}

/** 无 tsconfig 时：为单文件创建临时 service */
export function getOrCreateServiceForFile(
  ts: TsModule,
  workspaceDir: string,
  absFile: string
): ServiceBundle {
  const root = resolve(workspaceDir);
  const existing = cache.get(root);
  if (existing) return existing;

  // 若有 tsconfig，正常创建
  const configPath = ts.findConfigFile(root, ts.sys.fileExists.bind(ts.sys), "tsconfig.json");
  if (configPath) {
    return getTsService(ts, root);
  }

  // 单文件项目
  const file = resolve(absFile);
  const options: import("typescript").CompilerOptions = {
    allowJs: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
  };
  const host: import("typescript").LanguageServiceHost = {
    getCompilationSettings: () => options,
    getScriptFileNames: () => [file],
    getScriptVersion: () => {
      try {
        return String(statSync(file).mtimeMs);
      } catch {
        return "0";
      }
    },
    getScriptSnapshot: (fileName) => {
      try {
        return ts.ScriptSnapshot.fromString(readFileSync(fileName, "utf8"));
      } catch {
        return undefined;
      }
    },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: (opts) => ts.getDefaultLibFilePath(opts),
    fileExists: (f) => existsSync(f),
    readFile: (f) => {
      try {
        return readFileSync(f, "utf8");
      } catch {
        return undefined;
      }
    },
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const bundle: ServiceBundle = {
    ts,
    service,
    workspaceDir: root,
    dispose: () => {
      service.dispose();
      cache.delete(root + "::" + file);
    },
  };
  // 使用 workspace key 仍可能冲突；用 root 即可覆盖无 tsconfig 场景
  cache.set(root, bundle);
  return bundle;
}

export function resolveAbsFile(workspaceDir: string, filePath: string): string {
  if (!filePath) return "";
  if (existsSync(filePath) && (filePath.includes("/") || filePath.includes("\\") || /^[A-Za-z]:/.test(filePath))) {
    return resolve(filePath);
  }
  return resolve(workspaceDir, filePath);
}
