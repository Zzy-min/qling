import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { ProgressPhase, ProgressState, RecoveryEpisode } from "../agent/run-efficiency.js";
import { ContentAddressedArtifactStore } from "../harness/artifact-store.js";
import type { UsageLedgerSnapshot } from "../usage-ledger.js";

const execFileAsync = promisify(execFile);

export interface RunCheckpoint {
  sequence: number;
  phase: ProgressPhase;
  recoveryEpisode?: RecoveryEpisode;
  progressState?: ProgressState;
  workspaceDiffArtifact?: string;
  workspaceDiffFingerprint?: string;
  workspaceCaptureAvailable: boolean;
  workspaceCaptureError?: string;
  repositoryHead?: string;
  repositoryTree?: string;
  changedFileHashes: Record<string, string>;
  usage: UsageLedgerSnapshot;
  toolMetrics: { calls: number; failures: number; policyRedirects: number };
  latestVerification?: { verdict: "pass" | "fail" | "blocked"; verifierId?: string; fingerprint?: string };
  savedAt: number;
}

type CheckpointInput = Omit<RunCheckpoint, "workspaceDiffArtifact" | "workspaceDiffFingerprint" | "workspaceCaptureAvailable" | "workspaceCaptureError" | "repositoryHead" | "repositoryTree" | "changedFileHashes" | "savedAt">;

export class RunCheckpointStore {
  private readonly stateDir: string;
  private readonly workspaceDir: string;
  private readonly checkpointPath: string;
  private readonly artifacts: ContentAddressedArtifactStore;

  constructor(input: { stateDir: string; workspaceDir: string; runId: string }) {
    this.stateDir = path.resolve(input.stateDir);
    this.workspaceDir = path.resolve(input.workspaceDir);
    this.checkpointPath = path.join(this.stateDir, "run-checkpoints", `${input.runId}.json`);
    this.artifacts = new ContentAddressedArtifactStore(this.stateDir);
  }

  async save(input: CheckpointInput): Promise<RunCheckpoint> {
    const checkpoint = await this.materialize(input);
    await this.writeAtomic(checkpoint);
    return checkpoint;
  }

  async replaceWithBlockedBaseline(input: CheckpointInput, reason: string): Promise<RunCheckpoint> {
    let previous: string | null = null;
    try { previous = await fs.readFile(this.checkpointPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const checkpoint = await this.materialize(input);
    await this.writeAtomic(checkpoint);
    if (previous !== null) {
      const archive = `${this.checkpointPath}.unknown-${Date.now()}.json`;
      try {
        await fs.writeFile(archive, previous, { encoding: "utf8", mode: 0o600 });
        await fs.writeFile(`${archive}.reason.txt`, `${reason}\n`, { encoding: "utf8", mode: 0o600 });
      } catch {
        // The blocked main checkpoint is already durable. Archival is evidence-only best effort.
      }
    }
    return checkpoint;
  }

  private async materialize(input: CheckpointInput): Promise<RunCheckpoint> {
    const { diff, changedFiles, available, error, head, tree } = await this.captureDiff();
    const workspaceDiffArtifact = diff ? (await this.artifacts.put(diff, "text/x-diff; charset=utf-8")).hash : undefined;
    const workspaceDiffFingerprint = createHash("sha256").update(diff).digest("hex");
    const changedFileHashes: Record<string, string> = {};
    for (const relative of changedFiles) {
      const target = path.resolve(this.workspaceDir, relative);
      if (path.relative(this.workspaceDir, target).startsWith("..")) continue;
      try { changedFileHashes[relative] = createHash("sha256").update(await fs.readFile(target)).digest("hex"); } catch { changedFileHashes[relative] = "deleted"; }
    }
    const checkpoint: RunCheckpoint = { ...input, ...(workspaceDiffArtifact ? { workspaceDiffArtifact } : {}), workspaceDiffFingerprint, workspaceCaptureAvailable: available, ...(error ? { workspaceCaptureError: error } : {}), ...(head ? { repositoryHead: head } : {}), ...(tree ? { repositoryTree: tree } : {}), changedFileHashes, savedAt: Date.now() };
    return checkpoint;
  }

  private async writeAtomic(checkpoint: RunCheckpoint): Promise<void> {
    await fs.mkdir(path.dirname(this.checkpointPath), { recursive: true });
    const temp = `${this.checkpointPath}.${process.pid}.${Date.now()}.tmp`;
    const handle = await fs.open(temp, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temp, this.checkpointPath);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => {});
      throw error;
    }
  }

  async loadLatest(): Promise<RunCheckpoint | null> {
    try { return JSON.parse(await fs.readFile(this.checkpointPath, "utf8")) as RunCheckpoint; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async assessWorkspace(checkpoint: RunCheckpoint): Promise<{ consistent: boolean; mismatches: string[] }> {
    if (
      checkpoint.latestVerification?.verdict === "blocked"
      && checkpoint.progressState?.activeMutationId
    ) {
      return { consistent: true, mismatches: [] };
    }
    const current = await this.captureDiff();
    const mismatches: string[] = [];
    if (checkpoint.workspaceCaptureAvailable !== true) mismatches.push("<checkpoint-capture-unavailable>");
    if (!current.available) mismatches.push("<workspace-capture-unavailable>");
    if (!checkpoint.repositoryHead || !checkpoint.repositoryTree) mismatches.push("<repository-revision-missing>");
    else if (current.head !== checkpoint.repositoryHead || current.tree !== checkpoint.repositoryTree) mismatches.push("<repository-revision>");
    const expectedFiles = Object.keys(checkpoint.changedFileHashes).sort();
    const currentFiles = [...current.changedFiles].sort();
    if (!checkpoint.workspaceDiffFingerprint) mismatches.push("<checkpoint-fingerprint-missing>");
    else if (createHash("sha256").update(current.diff).digest("hex") !== checkpoint.workspaceDiffFingerprint) mismatches.push("<workspace-diff>");
    if (JSON.stringify(currentFiles) !== JSON.stringify(expectedFiles)) mismatches.push("<changed-file-set>");
    for (const [relative, expected] of Object.entries(checkpoint.changedFileHashes)) {
      const target = path.resolve(this.workspaceDir, relative);
      if (path.relative(this.workspaceDir, target).startsWith("..")) { mismatches.push(relative); continue; }
      let actual = "deleted";
      try { actual = createHash("sha256").update(await fs.readFile(target)).digest("hex"); } catch { /* deleted */ }
      if (actual !== expected) mismatches.push(relative);
    }
    return { consistent: mismatches.length === 0, mismatches: [...new Set(mismatches)] };
  }

  private async captureDiff(): Promise<{ diff: string; changedFiles: string[]; available: boolean; error?: string; head?: string; tree?: string }> {
    try {
      const head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: this.workspaceDir, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim();
      const tree = (await execFileAsync("git", ["rev-parse", "HEAD^{tree}"], { cwd: this.workspaceDir, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim();
      const diff = await execFileAsync("git", ["diff", "--binary", "HEAD"], { cwd: this.workspaceDir, windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
      const changed = await execFileAsync("git", ["diff", "--name-only", "HEAD"], { cwd: this.workspaceDir, windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      const untracked = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], { cwd: this.workspaceDir, windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
      const untrackedFiles = untracked.stdout.split(/\r?\n/).filter(Boolean);
      let untrackedDiff = "";
      for (const relative of untrackedFiles) {
        const result = await execFileAsync("git", ["diff", "--binary", "--no-index", "--", process.platform === "win32" ? "NUL" : "/dev/null", relative], { cwd: this.workspaceDir, windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 }).catch((error: NodeJS.ErrnoException & { stdout?: string }) => ({ stdout: error.stdout ?? "" }));
        untrackedDiff += result.stdout;
      }
      return { diff: `${diff.stdout}${untrackedDiff}`, changedFiles: [...new Set([...changed.stdout.split(/\r?\n/).filter(Boolean), ...untrackedFiles])], available: true, head, tree };
    } catch (error) {
      return { diff: "", changedFiles: [], available: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
