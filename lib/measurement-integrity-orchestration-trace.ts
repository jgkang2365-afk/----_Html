import traceDocument from "@/data/measurement-integrity-k2b-orchestration-trace.v0.5.json";

const FORBIDDEN_KEYS = new Set(["credential", "credentials", "password", "k2b_id", "k2b_pw", "requestedBy"]);
const FINAL_STATUSES = new Set(["PASS", "FAIL", "HOLD", "ENV_BLOCKED", "CANCELLED", "PENDING"]);
const GITHUB_API = "https://api.github.com/repos/jgkang2365-afk/----_Html";

type ReleaseStatus = "PASS" | "FAIL" | "PENDING" | "N/A" | "ENV_BLOCKED";

export type OrchestrationTraceDocument = typeof traceDocument;
export type OrchestrationTraceEntry = OrchestrationTraceDocument["entries"][number];
export type CurrentStateObservation = {
  observedAt: string;
  source: string;
  lookupStatus: "PASS" | "ENV_BLOCKED";
  statusAtObservation: {
    pullRequest: { state: string; draft: boolean; headSha: string; mergeable: string };
    githubActions: ReleaseStatus;
    vercelPreview: ReleaseStatus;
  };
  detail?: string;
};
export type OrchestrationTraceWithCurrentState = Omit<OrchestrationTraceDocument, "currentState"> & {
  currentState: Omit<OrchestrationTraceDocument["currentState"], "lastObservation"> & {
    lastObservation: CurrentStateObservation;
  };
};

function assertNoSensitiveKeys(value: unknown, path = "trace"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`민감정보 key는 trace에 기록할 수 없습니다: ${path}.${key}`);
    assertNoSensitiveKeys(child, `${path}.${key}`);
  }
}

function assertObservation(value: unknown, label: string): void {
  const observation = value as Record<string, unknown> | null;
  if (!observation || typeof observation.observedAt !== "string" || !observation.observedAt.trim()) {
    throw new Error(`${label} observedAt이 필요합니다.`);
  }
  if (typeof observation.source !== "string" || !observation.source.trim()) {
    throw new Error(`${label} source가 필요합니다.`);
  }
}

function assertTestAccounting(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [name, result] of Object.entries(value as Record<string, unknown>)) {
    if (!result || typeof result !== "object") continue;
    const row = result as Record<string, unknown>;
    if (!["total", "pass", "fail", "skip", "envBlocked"].some((key) => key in row)) continue;
    const total = Number(row.total ?? 0);
    const pass = Number(row.pass ?? 0);
    const fail = Number(row.fail ?? 0);
    const skip = Number(row.skip ?? 0);
    const envBlocked = Number(row.envBlocked ?? 0);
    if (![total, pass, fail, skip, envBlocked].every(Number.isFinite) || total !== pass + fail + skip + envBlocked) {
      throw new Error(`test accounting 불일치: ${name}`);
    }
  }
}

function assertRuntimeProvenance(entry: Record<string, unknown>): void {
  if (entry.experimentVersion !== "v0.5.2") return;
  const roles = Array.isArray(entry.roles) ? entry.roles : [];
  for (const rawRole of roles) {
    const role = rawRole as Record<string, unknown>;
    for (const key of ["requestedModel", "requestedEffort", "actualModel", "actualEffort", "runtimeEvidence", "runtimeSessionId", "parentRunId", "workerRunId"]) {
      if (!(key in role)) throw new Error(`v0.5.2 role ${String(role.roleId)}에 ${key}가 필요합니다.`);
    }
    if (!Array.isArray(role.runtimeEvidence) || role.runtimeEvidence.length === 0) {
      throw new Error(`v0.5.2 role ${String(role.roleId)} runtimeEvidence가 비어 있습니다.`);
    }
    const actualModel = String(role.actualModel);
    const actualEffort = String(role.actualEffort);
    if ((actualModel === "UNVERIFIABLE") !== (actualEffort === "UNVERIFIABLE")) {
      throw new Error(`v0.5.2 role ${String(role.roleId)} actual model/effort 상태가 일치하지 않습니다.`);
    }
    if (
      actualModel !== "UNVERIFIABLE" &&
      role.runtimeSessionId === "UNVERIFIABLE" &&
      role.workerRunId === "UNVERIFIABLE"
    ) {
      throw new Error(`v0.5.2 role ${String(role.roleId)} actual runtime execution ID가 필요합니다.`);
    }
  }
}

export function validateOrchestrationTrace(value: unknown): asserts value is OrchestrationTraceDocument {
  if (!value || typeof value !== "object") throw new Error("trace document가 객체가 아닙니다.");
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== 2 || document.subject !== "measurement-integrity-k2b") {
    throw new Error("지원하지 않는 orchestration trace schema입니다.");
  }
  if (!Array.isArray(document.entries) || document.entries.length === 0) throw new Error("trace entries가 비어 있습니다.");
  assertNoSensitiveKeys(document);
  const workspaceRecovery = document.workspaceRecovery as Record<string, unknown> | undefined;
  if (!workspaceRecovery || workspaceRecovery.workspaceMismatchDetected !== true || workspaceRecovery.recoveryResult !== "RECOVERED") {
    throw new Error("workspace recovery history가 올바르지 않습니다.");
  }
  if (typeof workspaceRecovery.actualWorkspaceAtDetection !== "string" || !Array.isArray(workspaceRecovery.recoveryMethod)) {
    throw new Error("workspace recovery evidence가 부족합니다.");
  }
  const currentState = document.currentState as Record<string, unknown> | undefined;
  if (!currentState) throw new Error("current state가 없습니다.");
  assertObservation(currentState.lastObservation, "current state");
  for (const rawEntry of document.entries) {
    const entry = rawEntry as Record<string, unknown>;
    if (typeof entry.experimentVersion !== "string" || typeof entry.runId !== "string" || !entry.runId.trim()) {
      throw new Error("trace entry 식별자가 올바르지 않습니다.");
    }
    if (!FINAL_STATUSES.has(String(entry.finalStatus))) throw new Error(`허용되지 않은 최종 상태: ${String(entry.finalStatus)}`);
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) throw new Error(`${entry.experimentVersion} evidence가 비어 있습니다.`);
    if (Array.isArray(entry.historicalObservations)) {
      entry.historicalObservations.forEach((observation) => assertObservation(observation, `${entry.experimentVersion} history`));
    }
    assertRuntimeProvenance(entry);
    assertTestAccounting(entry.testAccounting);
    if (
      entry.finalStatus === "PASS" &&
      (entry.functionalStatus === "HOLD" || entry.orchestrationStatus === "HOLD" ||
        (Array.isArray(entry.holdReasons) && entry.holdReasons.length > 0))
    ) {
      throw new Error(`${entry.experimentVersion} 필수 Gate가 HOLD인데 final PASS일 수 없습니다.`);
    }
  }
}

function statusFromConclusion(value: unknown): ReleaseStatus {
  const normalized = String(value ?? "").toLowerCase();
  if (["success", "neutral", "skipped"].includes(normalized)) return "PASS";
  if (["failure", "timed_out", "cancelled", "action_required", "stale"].includes(normalized)) return "FAIL";
  return "PENDING";
}

async function githubJson(path: string): Promise<unknown> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GITHUB_READ_${response.status}`);
  return response.json();
}

function fallbackCurrentState(detail: string): CurrentStateObservation {
  const fallback = traceDocument.currentState.lastObservation;
  return {
    ...fallback,
    observedAt: new Date().toISOString(),
    source: "github_api_live_read_only",
    lookupStatus: "ENV_BLOCKED",
    statusAtObservation: {
      ...fallback.statusAtObservation,
      githubActions: fallback.statusAtObservation.githubActions as ReleaseStatus,
      vercelPreview: fallback.statusAtObservation.vercelPreview as ReleaseStatus,
    },
    detail,
  };
}

export async function getMeasurementIntegrityOrchestrationTraceWithCurrentState(): Promise<OrchestrationTraceWithCurrentState> {
  validateOrchestrationTrace(traceDocument);
  try {
    const pullRequest = await githubJson("/pulls/108") as Record<string, unknown>;
    const head = pullRequest.head as { sha?: unknown } | undefined;
    const headSha = typeof head?.sha === "string" ? head.sha : "UNKNOWN";
    const [actions, statuses, checks] = await Promise.all([
      githubJson(`/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=1`),
      githubJson(`/commits/${encodeURIComponent(headSha)}/status`),
      githubJson(`/commits/${encodeURIComponent(headSha)}/check-runs?per_page=100`),
    ]);
    const actionRuns = (actions as { workflow_runs?: Array<{ status?: unknown; conclusion?: unknown }> }).workflow_runs ?? [];
    const githubActions: ReleaseStatus = actionRuns.length === 0 ? "N/A" : actionRuns[0].status === "completed" ? statusFromConclusion(actionRuns[0].conclusion) : "PENDING";
    const statusContexts = (statuses as { statuses?: Array<{ context?: unknown; state?: unknown }> }).statuses ?? [];
    const checkRuns = (checks as { check_runs?: Array<{ name?: unknown; status?: unknown; conclusion?: unknown }> }).check_runs ?? [];
    const vercelStatus = statusContexts.find((status) => String(status.context).toLowerCase().includes("vercel"));
    const vercelCheck = checkRuns.find((check) => String(check.name).toLowerCase().includes("vercel"));
    const vercelPreview: ReleaseStatus = vercelStatus
      ? statusFromConclusion(vercelStatus.state)
      : vercelCheck ? (vercelCheck.status === "completed" ? statusFromConclusion(vercelCheck.conclusion) : "PENDING") : "N/A";
    const liveObservation: CurrentStateObservation = {
      observedAt: new Date().toISOString(),
      source: "github_api_live_read_only",
      lookupStatus: "PASS",
      statusAtObservation: {
        pullRequest: { state: String(pullRequest.state ?? "UNKNOWN"), draft: pullRequest.draft === true, headSha, mergeable: String(pullRequest.mergeable_state ?? "UNKNOWN") },
        githubActions,
        vercelPreview,
      },
    };
    return { ...traceDocument, currentState: { ...traceDocument.currentState, lastObservation: liveObservation } } as OrchestrationTraceWithCurrentState;
  } catch (error) {
    return { ...traceDocument, currentState: { ...traceDocument.currentState, lastObservation: fallbackCurrentState(error instanceof Error ? error.message : "GITHUB_READ_FAILED") } } as OrchestrationTraceWithCurrentState;
  }
}

export function getMeasurementIntegrityOrchestrationTrace(): OrchestrationTraceDocument {
  validateOrchestrationTrace(traceDocument);
  return traceDocument;
}
