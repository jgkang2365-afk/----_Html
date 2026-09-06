import traceDocument from "@/data/measurement-integrity-k2b-orchestration-trace.v0.5.json";

const FORBIDDEN_KEYS = new Set(["credential", "credentials", "password", "k2b_id", "k2b_pw", "requestedBy"]);
const FINAL_STATUSES = new Set(["PASS", "FAIL", "HOLD", "ENV_BLOCKED", "CANCELLED", "PENDING"]);

export type OrchestrationTraceDocument = typeof traceDocument;
export type OrchestrationTraceEntry = OrchestrationTraceDocument["entries"][number];

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

export function validateOrchestrationTrace(value: unknown): asserts value is OrchestrationTraceDocument {
  if (!value || typeof value !== "object") throw new Error("trace document가 객체가 아닙니다.");
  const document = value as Record<string, unknown>;
  if (document.schemaVersion !== 1 || document.subject !== "measurement-integrity-k2b") {
    throw new Error("지원하지 않는 orchestration trace schema입니다.");
  }
  if (!Array.isArray(document.entries) || document.entries.length === 0) throw new Error("trace entries가 비어 있습니다.");
  assertNoSensitiveKeys(document);
  for (const rawEntry of document.entries) {
    const entry = rawEntry as Record<string, unknown>;
    if (typeof entry.experimentVersion !== "string" || typeof entry.runId !== "string" || !entry.runId.trim()) {
      throw new Error("trace entry 식별자가 올바르지 않습니다.");
    }
    if (!FINAL_STATUSES.has(String(entry.finalStatus))) throw new Error(`허용되지 않은 최종 상태: ${String(entry.finalStatus)}`);
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) throw new Error(`${entry.experimentVersion} evidence가 비어 있습니다.`);
  }
}

export function getMeasurementIntegrityOrchestrationTrace(): OrchestrationTraceDocument {
  validateOrchestrationTrace(traceDocument);
  return traceDocument;
}
