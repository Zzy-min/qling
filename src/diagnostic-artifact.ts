import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { getRuntimeRootsFromEnv, resolveToolPath } from "./runtime-paths.js";

const execFileAsync = promisify(execFile);

const SCRIPT_EXTENSION = "(?:py|js|mjs|cjs|ts|ps1|sh)";
const ALWAYS_DIAGNOSTIC = new RegExp(
  `^(?:_(?:verify|probe|debug|tmp)[\\w.-]*|(?:probe|debug|verify|repro|reproduce|net_probe|np_ver)[\\w.-]*)\\.${SCRIPT_EXTENSION}$`,
  "i",
);
const DIAGNOSTIC_OUTPUT = /^(?:env(?:ironment)?_check|check_(?:env|environment|deps|runtime)|runtime_check|dependency_check|probe|debug|verify|repro|reproduce|net_probe|np_ver)[\w.-]*\.(?:txt|log|out)$/i;
const GENERATED_CACHE_PATH = /^(?:\.cache\/)?pip\/cache(?:\/|$)/i;
const ENVIRONMENT_DIAGNOSTIC = new RegExp(
  `^(?:env(?:ironment)?_check|check_(?:env|environment|deps|runtime)|runtime_check|dependency_check)\\.${SCRIPT_EXTENSION}$`,
  "i",
);
const FIX_SCRIPT = new RegExp(`^fix_[\\w.-]+\\.${SCRIPT_EXTENSION}$`, "i");

function looksLikeEnvironmentProbe(content: string): boolean {
  const readsEnvironment = /(?:sys\.version|platform\.(?:platform|python_version)|(?:astropy|numpy|pytest)\.__version__|importlib\.metadata)/i.test(content);
  const onlyReports = /(?:print\s*\(|Write-Output|echo\s+)/i.test(content);
  const implementsBehavior = /(?:^|\n)\s*(?:def|class|function)\s+|\bexport\s+|write(?:File|Text)?\s*\(|open\s*\([^\n]+["']w|Set-Content|Out-File/i.test(content);
  return readsEnvironment && onlyReports && !implementsBehavior;
}

export function isRootDiagnosticArtifact(
  inputPath: string,
  content = "",
  workspaceDir?: string,
): boolean {
  let name: string;
  if (workspaceDir) {
    const workspace = resolve(workspaceDir);
    const candidate = resolve(workspace, inputPath);
    if (dirname(candidate).toLowerCase() !== workspace.toLowerCase()) return false;
    name = basename(candidate);
  } else {
    const normalized = inputPath.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
    if (isAbsolute(inputPath) || normalized.includes("/") || normalized.includes("..")) return false;
    name = normalized;
  }

  if (ALWAYS_DIAGNOSTIC.test(name)) return true;
  if (DIAGNOSTIC_OUTPUT.test(name)) return true;
  if (looksLikeEnvironmentProbe(content) && new RegExp(`\\.${SCRIPT_EXTENSION}$`, "i").test(name)) return true;
  if (ENVIRONMENT_DIAGNOSTIC.test(name)) {
    return looksLikeEnvironmentProbe(content);
  }
  if (!FIX_SCRIPT.test(name)) return false;
  return /(?:\.replace\s*\(|write(?:File|Text)?\s*\(|open\s*\([^\n]+["']w|Set-Content|Out-File)/i.test(content)
    && /(?:src\/|src\\|lib\/|lib\\|astropy\/|astropy\\|\.py["']|\.ts["']|\.js["'])/i.test(content);
}

export function isDiagnosticArtifact(
  inputPath: string,
  content = "",
  workspaceDir?: string,
): boolean {
  let normalized = inputPath.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
  if (workspaceDir) {
    const workspace = resolve(workspaceDir);
    const candidate = resolve(workspace, inputPath);
    normalized = relative(workspace, candidate).replace(/\\/g, "/");
    if (!normalized || normalized.startsWith("../") || isAbsolute(normalized)) return false;
  } else if (isAbsolute(inputPath) || normalized.includes("..")) {
    return false;
  }
  if (GENERATED_CACHE_PATH.test(normalized)) return true;
  return isRootDiagnosticArtifact(inputPath, content, workspaceDir);
}

export function addedPatchContent(patch: string, file: string): string {
  const normalizedFile = file.replace(/\\/g, "/");
  const blocks = patch.split(/^diff --git /m).slice(1);
  const block = blocks.find((candidate) => {
    const firstLine = candidate.split(/\r?\n/, 1)[0] ?? "";
    return firstLine.includes(`a/${normalizedFile} b/${normalizedFile}`);
  });
  if (!block) return "";
  return block
    .split(/\r?\n/)
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

export function resolveExplicitDeliverablePaths(
  workspaceDir = process.cwd(),
  raw = String(process.env.QLING_DELIVERABLE_PATHS ?? ""),
): string[] {
  const workspace = resolve(workspaceDir);
  const roots = { ...getRuntimeRootsFromEnv(), workspaceDir: workspace };
  return raw.split(",").map((value) => value.trim()).filter(Boolean).flatMap((value) => {
    const target = resolveToolPath(value, roots, "workspace");
    const relativePath = relative(workspace, target).replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
    return relativePath && relativePath !== ".." && !relativePath.startsWith("../") && !isAbsolute(relativePath)
      ? [relativePath]
      : [];
  });
}

export async function isUntrackedRootDiagnosticArtifact(
  inputPath: string,
  content = "",
  workspaceDir = process.cwd(),
): Promise<boolean> {
  if (!isRootDiagnosticArtifact(inputPath, content, workspaceDir)) return false;
  const workspace = resolve(workspaceDir);
  const candidate = resolve(workspace, inputPath);
  const relativePath = relative(workspace, candidate).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("../") || isAbsolute(relativePath)) return false;
  const explicitDeliverables = resolveExplicitDeliverablePaths(workspace);
  if (explicitDeliverables.includes(relativePath)) return false;
  try {
    await access(candidate);
  } catch {
    return true;
  }
  try {
    const result = await execFileAsync(
      "git",
      ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "--", relativePath],
      { cwd: workspace, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    return result.stdout.split(/\r?\n/).some((value) => value.replace(/\\/g, "/") === relativePath);
  } catch {
    // Existing files in a non-Git or unavailable repository are not silently
    // redirected; only provably untracked/new diagnostics are isolated.
    return false;
  }
}

export async function isUntrackedDiagnosticArtifact(
  inputPath: string,
  content = "",
  workspaceDir = process.cwd(),
): Promise<boolean> {
  if (!isDiagnosticArtifact(inputPath, content, workspaceDir)) return false;
  const workspace = resolve(workspaceDir);
  const candidate = resolve(workspace, inputPath);
  const relativePath = relative(workspace, candidate).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("../") || isAbsolute(relativePath)) return false;
  const explicitDeliverables = resolveExplicitDeliverablePaths(workspace);
  if (explicitDeliverables.includes(relativePath)) return false;
  try {
    const result = await execFileAsync(
      "git",
      ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "--", relativePath],
      { cwd: workspace, windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    return result.stdout.split(/\r?\n/).some((value) => value.replace(/\\/g, "/") === relativePath);
  } catch {
    return false;
  }
}
