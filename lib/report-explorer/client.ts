import type {
  ReportExplorerHealth,
  ReportExplorerIssue,
  ReportExplorerIssueKind,
  ReportExplorerMatch,
  ReportExplorerQueryResult,
  ReportExplorerQueryStatus,
  ReportExplorerSearchRequest,
} from "@/lib/report-explorer/types";

const REPORT_EXPLORER_BASE_URL = "http://127.0.0.1:17653";

type JsonObject = Record<string, unknown>;

export class ReportExplorerClientError extends Error {
  constructor(
    message: string,
    readonly issues: ReportExplorerIssue[]
  ) {
    super(message);
    this.name = "ReportExplorerClientError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function messageFromPayload(payload: unknown, fallback: string) {
  if (!isObject(payload)) return fallback;

  for (const key of ["error", "message", "detail"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return fallback;
}

function issueKindsFromPayload(payload: unknown, status?: number): ReportExplorerIssueKind[] {
  const message = messageFromPayload(payload, "").toLowerCase();
  const kinds = new Set<ReportExplorerIssueKind>();

  if (status === 401 || status === 403 || /permission|access denied|권한|접근 거부/.test(message)) {
    kinds.add("permission");
  }
  if (/root|directory|folder|path|루트|경로|폴더/.test(message)) {
    kinds.add("root");
  }

  if (isObject(payload)) {
    if (payload.permissionGranted === false || payload.hasPermission === false) {
      kinds.add("permission");
    }
    if (
      payload.rootAccessible === false ||
      payload.rootExists === false ||
      payload.rootConfigured === false
    ) {
      kinds.add("root");
    }
  }

  return [...kinds];
}

function issuesFromPayload(
  payload: unknown,
  fallback: string,
  status?: number
): ReportExplorerIssue[] {
  return issueKindsFromPayload(payload, status).map((kind) => ({
    kind,
    message: messageFromPayload(payload, fallback),
  }));
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function request(path: string, init: RequestInit = {}) {
  let response: Response;

  try {
    response = await fetch(`${REPORT_EXPLORER_BASE_URL}${path}`, {
      cache: "no-store",
      ...init,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;

    throw new ReportExplorerClientError("보고서 탐색기 로컬 서비스에 연결할 수 없습니다.", [
      {
        kind: "disconnected",
        message: "보고서 탐색기 로컬 서비스에 연결할 수 없습니다.",
      },
    ]);
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const fallback = `보고서 탐색기 요청이 실패했습니다. (HTTP ${response.status})`;
    const issues = issuesFromPayload(payload, fallback, response.status);
    throw new ReportExplorerClientError(messageFromPayload(payload, fallback), issues);
  }

  return payload;
}

function asMatch(value: unknown): ReportExplorerMatch | null {
  if (!isObject(value)) return null;
  const { resultId, folderName, path } = value;

  if (typeof resultId !== "string" || typeof folderName !== "string" || typeof path !== "string")
    return null;
  return { resultId, folderName, path };
}

function asQueryResult(value: unknown): ReportExplorerQueryResult | null {
  if (!isObject(value)) return null;
  const { query, status, matches } = value;
  if (typeof query !== "string" || !["FOUND", "MULTIPLE", "NOT_FOUND"].includes(String(status)))
    return null;

  return {
    query,
    status: status as ReportExplorerQueryStatus,
    matches: Array.isArray(matches)
      ? matches.map(asMatch).filter((match): match is ReportExplorerMatch => match !== null)
      : [],
  };
}

export async function getReportExplorerHealth(signal?: AbortSignal): Promise<ReportExplorerHealth> {
  try {
    const payload = await request("/health", { signal });
    const message = isObject(payload) ? messageFromPayload(payload, "") || null : null;
    const issues = issuesFromPayload(
      payload,
      message || "보고서 탐색기 상태를 확인할 수 없습니다."
    );

    return { issues, message };
  } catch (error) {
    if (error instanceof ReportExplorerClientError) {
      return { issues: error.issues, message: error.message };
    }
    throw error;
  }
}

export async function searchReportExplorer(
  requestBody: ReportExplorerSearchRequest,
  signal?: AbortSignal
): Promise<ReportExplorerQueryResult[]> {
  const payload = await request("/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal,
  });

  const results = Array.isArray(payload)
    ? payload
    : isObject(payload) && Array.isArray(payload.results)
      ? payload.results
      : null;

  if (!results) {
    throw new ReportExplorerClientError("보고서 탐색기 응답 형식이 올바르지 않습니다.", []);
  }

  return results
    .map(asQueryResult)
    .filter((result): result is ReportExplorerQueryResult => result !== null);
}

export async function openReportExplorerResult(
  resultId: string,
  signal?: AbortSignal
): Promise<void> {
  await request("/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resultId }),
    signal,
  });
}
