export interface SwebenchPredictionEvidence {
  agentResultOk: boolean;
  /** The candidate is paused only because local verification is unavailable;
   * the official SWE-bench grader remains the required verifier. */
  officialGraderPending?: boolean;
  patch: string;
  latestVerificationVerdict?: "pass" | "fail" | "blocked";
  changedFiles?: string[];
  untrackedFiles?: string[];
  deliverableFiles?: string[];
}

export interface SwebenchPredictionDecision {
  eligible: boolean;
  modelPatch: string;
  reason?: "agent_incomplete" | "verification_not_passed" | "diagnostic_artifact_present" | "test_artifact_modified" | "empty_patch";
}

export interface SwebenchSourcePredictionEvidence extends Omit<SwebenchPredictionEvidence, "patch"> {
  rawPatch: string;
  sourcePatch: string;
  diagnosticFiles: readonly string[];
}

export interface OfficialGraderPendingEvidence {
  agentOutcome?: string;
  resultText?: string;
  checkpoint?: {
    phase?: string;
    workspaceCaptureAvailable?: boolean;
    latestVerification?: { verdict?: string };
    progressState?: {
      activeMutationId?: string;
      activeMutationPaths?: string[];
      pendingSideEffectIds?: string[];
    };
  };
}

export interface SwebenchModelRoute {
  provider: string;
  endpoint: string;
  model: string;
}

export function isSupportedSwebenchModelRoute(route: SwebenchModelRoute): boolean {
  const provider = route.provider.trim().toLowerCase();
  const model = route.model.trim().toLowerCase();
  if (model !== "deepseek-chat" && model !== "deepseek-v4-flash") return false;
  if (provider === "deepseek") return true;
  if (provider !== "openai") return false;

  try {
    const endpoint = new URL(route.endpoint);
    const pathname = endpoint.pathname.replace(/\/+$/, "");
    return endpoint.protocol === "https:"
      && endpoint.hostname.toLowerCase() === "chatapi.weixin.qq.com"
      && endpoint.username === ""
      && endpoint.password === ""
      && endpoint.search === ""
      && endpoint.hash === ""
      && pathname === "/openai/v1";
  } catch {
    return false;
  }
}

export function buildSwebenchAgentEnvironment(
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...base,
    QLING_FEATURES_SEMANTIC_MEMORY: "false",
  };
}

export function isOfficialGraderPendingCandidate(evidence: OfficialGraderPendingEvidence): boolean {
  const checkpoint = evidence.checkpoint;
  const progressState = checkpoint?.progressState;
  return evidence.agentOutcome === "paused"
    && /^验证环境未就绪/.test(evidence.resultText ?? "")
    && checkpoint?.phase === "verify"
    && checkpoint.workspaceCaptureAvailable === true
    && Boolean(progressState?.activeMutationId)
    && (progressState?.activeMutationPaths ?? []).some((value) => value && !value.startsWith("<"))
    && (progressState?.pendingSideEffectIds ?? []).length === 0
    && !checkpoint.latestVerification?.verdict;
}

export function normalizeGitPatchForTransport(patch: string): string {
  return patch.replace(/\r\n/g, "\n");
}

export function containsDiagnosticArtifact(files: readonly string[], patch = ""): boolean {
  return files.some((file) => isRootDiagnosticArtifact(file, addedPatchContent(patch, file)));
}

export function containsTestArtifact(files: readonly string[]): boolean {
  return files.some((file) => {
    const normalized = file.replace(/\\/g, "/").replace(/^(?:a|b)\//, "").toLowerCase();
    const segments = normalized.split("/").filter(Boolean);
    const basename = segments.at(-1) ?? "";
    return segments.slice(0, -1).some((segment) => segment === "test" || segment === "tests")
      || basename === "conftest.py"
      || /^test_[^/]+\.[a-z0-9]+$/.test(basename)
      || /(?:_test|\.test|\.spec)\.[a-z0-9]+$/.test(basename);
  });
}

/**
 * Keep the complete raw workspace patch for audit, while deriving a separate
 * source-only observation patch for the official grader. This does not make an
 * ineligible prediction eligible.
 */
export function diagnosticArtifactPathspecExclusions(files: readonly string[], patch = ""): string[] {
  return files.filter((file) => {
    const normalized = file.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "");
    const content = addedPatchContent(patch, file);
    // Exact observed scratch files only. Prefixes such as `_sim_*.py`, `_smoke_*.py`,
    // or `zz_*` would drop legitimate private production modules from the official candidate.
    const observedSwebenchScratch = !normalized.includes("/")
      && /^(?:_runner\.py|_t\.txt|_checkenv\.py|_sim_rst\.py|_smoke_rst\.py|_test_qdp\.py|_test_regex\.py|tmptest_qdp_standalone\.py|zz_repro\.py|zz_out\.txt)$/i.test(normalized);
    const observedNestedSwebenchScratch = /^(?:astropy\/io\/ascii\/_qdp_regex_test\.py|astropy\/io\/ascii\/_qdp_test_repro\.py|astropy\/io\/ascii\/_qdp_test_repro\.qdp)$/i.test(normalized);
    const dependencyTestShim = !normalized.includes("/")
      && /_shim\.py$/i.test(normalized)
      && /test-only\s+shim/i.test(content)
      && /(?:restore aliases removed|setattr\s*\(\s*np\s*,)/i.test(content);
    return observedSwebenchScratch || observedNestedSwebenchScratch || dependencyTestShim || isDiagnosticArtifact(file, content);
  });
}

export function decideSwebenchSourcePrediction(
  evidence: SwebenchSourcePredictionEvidence,
): SwebenchPredictionDecision {
  const excluded = new Set(evidence.diagnosticFiles.map((file) => file.replace(/\\/g, "/")));
  return decideSwebenchPrediction({
    agentResultOk: evidence.agentResultOk,
    officialGraderPending: evidence.officialGraderPending,
    latestVerificationVerdict: evidence.latestVerificationVerdict,
    patch: evidence.sourcePatch,
    changedFiles: (evidence.changedFiles ?? []).filter((file) => !excluded.has(file.replace(/\\/g, "/"))),
    untrackedFiles: (evidence.untrackedFiles ?? []).filter((file) => !excluded.has(file.replace(/\\/g, "/"))),
    deliverableFiles: evidence.deliverableFiles,
  });
}

export function decideSwebenchPrediction(
  evidence: SwebenchPredictionEvidence,
): SwebenchPredictionDecision {
  if (!evidence.agentResultOk && !evidence.officialGraderPending) {
    return { eligible: false, modelPatch: "", reason: "agent_incomplete" };
  }
  if (evidence.latestVerificationVerdict !== "pass" && !evidence.officialGraderPending) {
    return { eligible: false, modelPatch: "", reason: "verification_not_passed" };
  }
  const explicitDeliverables = new Set((evidence.deliverableFiles ?? []).map((file) => file.replace(/\\/g, "/")));
  const diagnosticCandidates = (evidence.untrackedFiles ?? evidence.changedFiles ?? [])
    .filter((file) => !explicitDeliverables.has(file.replace(/\\/g, "/")));
  if (containsDiagnosticArtifact(diagnosticCandidates, evidence.patch)) {
    return { eligible: false, modelPatch: "", reason: "diagnostic_artifact_present" };
  }
  if (containsTestArtifact(evidence.changedFiles ?? [])) {
    return { eligible: false, modelPatch: "", reason: "test_artifact_modified" };
  }
  const normalizedPatch = normalizeGitPatchForTransport(evidence.patch);
  if (!normalizedPatch.trim()) {
    return { eligible: false, modelPatch: "", reason: "empty_patch" };
  }
  return { eligible: true, modelPatch: normalizedPatch };
}
import { addedPatchContent, isDiagnosticArtifact, isRootDiagnosticArtifact } from "../diagnostic-artifact.js";
