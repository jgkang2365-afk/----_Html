"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/Table";
import type { IntegrityIssue, IntegritySeverity } from "@/lib/measurement-target-integrity";
import type { OrchestrationTraceDocument } from "@/lib/measurement-integrity-orchestration-trace";

type TraceExecutionContext = {
  environment?: string;
  incident?: string;
  productionImpact?: string;
  previousFailure?: string;
  discoverer?: string;
  migration?: { rootCause?: string; status?: string };
  stagingCloseout?: {
    retainedSchemaChanges?: string[];
    cleanedTestData?: string[];
    remainingTestData?: string[];
    remainingTemporarySchema?: string[];
    productionResyncRequired?: boolean;
    finalState?: string;
    followUpRequired?: string[];
  };
};

const severityClass: Record<IntegritySeverity, string> = {
  ERROR: "bg-rose-50 text-rose-800 border-rose-200",
  WARNING: "bg-amber-50 text-amber-800 border-amber-200",
  REVIEW: "bg-slate-100 text-slate-700 border-slate-200",
  NORMAL: "bg-emerald-50 text-emerald-800 border-emerald-200",
};

export function MeasurementTargetIntegrityPanel({
  year,
  period,
  onBack,
}: {
  year: number;
  period: string;
  onBack: () => void;
}) {
  const [issues, setIssues] = useState<IntegrityIssue[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [scope, setScope] = useState("abnormal");
  const [trace, setTrace] = useState<OrchestrationTraceDocument | null>(null);
  const [traceVisible, setTraceVisible] = useState(false);
  const [traceLoading, setTraceLoading] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState("v0.5.1");

  const loadTrace = async () => {
    if (trace) {
      setTraceVisible((visible) => !visible);
      return;
    }
    setTraceLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/businesses/integrity/trace?t=${Date.now()}`, {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "오케스트레이션 이력을 불러오지 못했습니다.");
      setTrace(body);
      setTraceVisible(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "오케스트레이션 이력을 불러오지 못했습니다."
      );
    } finally {
      setTraceLoading(false);
    }
  };

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/businesses/integrity?year=${year}&period=${encodeURIComponent(period)}&t=${Date.now()}`,
        { cache: "no-store" }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "점검 결과를 불러오지 못했습니다.");
      setIssues(body.issues || []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "점검 결과를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const types = useMemo(
    () => Array.from(new Set((issues || []).map((issue) => issue.type))),
    [issues]
  );
  const visible = useMemo(
    () =>
      (issues || []).filter((issue) => {
        const keyword = search.trim().toLowerCase();
        return (
          (!keyword || `${issue.businessName} ${issue.code}`.toLowerCase().includes(keyword)) &&
          (type === "all" || issue.type === type) &&
          (severity === "all" || issue.severity === severity) &&
          (scope === "all" || issue.status !== "정상")
        );
      }),
    [issues, search, type, severity, scope]
  );
  const selectedTrace = useMemo(
    () => trace?.entries.find((entry) => entry.experimentVersion === selectedVersion) ?? null,
    [selectedVersion, trace]
  );
  const selectedTraceContext = selectedTrace as
    | (typeof selectedTrace & TraceExecutionContext)
    | null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800">측정대상 정합성 점검</h2>
          <p className="text-xs text-slate-500">
            읽기 전용 진단 · {year}년 {period} · K2B 실제결과는 별도 검증 상태로만 표시됩니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onBack}>
            목록
          </Button>
          <Button variant="secondary" onClick={loadTrace} disabled={traceLoading}>
            {traceLoading ? "이력 확인 중" : traceVisible ? "이력 닫기" : "오케스트레이션 이력"}
          </Button>
          <Button variant="primary" onClick={run} disabled={loading}>
            {loading ? "점검 중" : "점검 실행"}
          </Button>
        </div>
      </div>
      {traceVisible && trace && selectedTrace && (
        <section
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
          aria-label="K2B 오케스트레이션 이력"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-800">버전별 오케스트레이션 변화</h3>
              <p className="text-xs text-slate-500">
                결과뿐 아니라 배정·판단·검증 근거를 Git 이력으로 확인합니다.
              </p>
            </div>
            <div className="flex flex-wrap gap-1" aria-label="실험 버전">
              {trace.entries.map((entry) => (
                <button
                  key={entry.experimentVersion}
                  type="button"
                  aria-pressed={selectedVersion === entry.experimentVersion}
                  onClick={() => setSelectedVersion(entry.experimentVersion)}
                  className={`rounded border px-2 py-1 text-xs font-semibold ${selectedVersion === entry.experimentVersion ? "border-blue-300 bg-blue-50 text-blue-800" : "border-slate-200 text-slate-600"}`}
                >
                  {entry.experimentVersion}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3">
            <p className="text-xs font-semibold text-blue-900">
              {selectedTrace.delta
                ? `${selectedTrace.delta.from} → ${selectedTrace.experimentVersion}`
                : `${selectedTrace.experimentVersion} 직접 비교 근거 없음`}
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-blue-900">
              {(selectedTrace.delta?.changes || selectedTrace.carryForward).map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-slate-500">Experiment / Run</dt>
              <dd className="font-semibold text-slate-800">
                {selectedTrace.experimentVersion} · {selectedTrace.runId}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">기준 main</dt>
              <dd className="truncate font-mono text-slate-800" title={selectedTrace.baseSha}>
                {selectedTrace.baseSha}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">최종 상태 / verifier</dt>
              <dd className="font-semibold text-slate-800">
                {selectedTrace.finalStatus} · {selectedTrace.verifierResult}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Worker / 재배정 / 승격</dt>
              <dd className="font-semibold text-slate-800">
                {selectedTrace.workerCount ?? "UNKNOWN"} /{" "}
                {selectedTrace.reassignmentCount ?? "UNKNOWN"} /{" "}
                {selectedTrace.modelEscalationCount ?? "UNKNOWN"}
              </dd>
            </div>
          </dl>
          {selectedTraceContext?.environment && (
            <dl className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <dt className="text-slate-500">환경 / 영향</dt>
                <dd className="font-semibold text-slate-800">
                  {selectedTraceContext.environment} · {selectedTraceContext.productionImpact}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">이전 실패 / 발견자</dt>
                <dd className="font-semibold text-slate-800">
                  {selectedTraceContext.previousFailure} · {selectedTraceContext.discoverer}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Migration / 원인</dt>
                <dd className="font-semibold text-slate-800">
                  {selectedTraceContext.migration?.status} ·{" "}
                  {selectedTraceContext.migration?.rootCause}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Incident</dt>
                <dd className="font-semibold text-slate-800">{selectedTraceContext.incident}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Verifier</dt>
                <dd className="font-semibold text-slate-800">{selectedTrace.verifierResult}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Final status</dt>
                <dd className="font-semibold text-slate-800">{selectedTrace.finalStatus}</dd>
              </div>
            </dl>
          )}
          {selectedTraceContext?.stagingCloseout && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-950">
              <p className="font-semibold">Staging 종료 상태</p>
              <dl className="mt-1 grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-emerald-700">유지한 schema 변경</dt>
                  <dd>
                    {selectedTraceContext.stagingCloseout.retainedSchemaChanges?.join(" · ") ||
                      "없음"}
                  </dd>
                </div>
                <div>
                  <dt className="text-emerald-700">정리한 테스트 데이터</dt>
                  <dd>
                    {selectedTraceContext.stagingCloseout.cleanedTestData?.join(" · ") || "없음"}
                  </dd>
                </div>
                <div>
                  <dt className="text-emerald-700">남은 임시 데이터 / schema</dt>
                  <dd>
                    {[
                      ...(selectedTraceContext.stagingCloseout.remainingTestData || []),
                      ...(selectedTraceContext.stagingCloseout.remainingTemporarySchema || []),
                    ].join(" · ") || "없음"}
                  </dd>
                </div>
                <div>
                  <dt className="text-emerald-700">Production 재동기화</dt>
                  <dd>
                    {selectedTraceContext.stagingCloseout.productionResyncRequired
                      ? "필요"
                      : "불필요"}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-emerald-700">최종 상태</dt>
                  <dd>{selectedTraceContext.stagingCloseout.finalState}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-emerald-700">추가 조치</dt>
                  <dd>
                    {selectedTraceContext.stagingCloseout.followUpRequired?.join(" · ") || "없음"}
                  </dd>
                </div>
              </dl>
            </div>
          )}
          {selectedTrace.holdReasons.length > 0 && (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <strong>HOLD/FAIL:</strong> {selectedTrace.holdReasons.join(" · ")}
            </p>
          )}
          {selectedTrace.roles.length > 0 && (
            <div className="overflow-x-auto rounded border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>역할</TableHead>
                    <TableHead>모델/effort</TableHead>
                    <TableHead>권한</TableHead>
                    <TableHead>결과</TableHead>
                    <TableHead>재배정</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedTrace.roles.map((role) => (
                    <TableRow key={role.roleId}>
                      <TableCell>
                        <span className="font-semibold">{role.name}</span>
                        <span
                          className="block max-w-72 text-[11px] text-slate-500"
                          title={role.findings.join(" · ")}
                        >
                          {role.findings.join(" · ") || "발견사항 없음"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {role.requestedModel} / {role.requestedEffort}
                        <span className="block text-[11px] text-slate-500">
                          runtime: {role.actualRuntime}
                        </span>
                      </TableCell>
                      <TableCell>{role.permission}</TableCell>
                      <TableCell>{role.status}</TableCell>
                      <TableCell>
                        {"reassignment" in role ? role.reassignment : "UNKNOWN"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <div className="text-xs text-slate-600">
            <strong>Coordinator 판단:</strong>{" "}
            {selectedTrace.decisions.length
              ? selectedTrace.decisions
                  .map((decision) => `${decision.action}: ${decision.reason}`)
                  .join(" · ")
              : "UNKNOWN / historical evidence unavailable"}
          </div>
          <div className="text-xs text-slate-600">
            <strong>검증 근거:</strong>{" "}
            {[
              ...selectedTrace.verifications,
              ...selectedTrace.evidence.map((item) => `${item.claim} (${item.reference})`),
            ].join(" · ")}
          </div>
          <div className="text-xs text-slate-600">
            <strong>다음 버전 전달:</strong> {selectedTrace.carryForward.join(" · ") || "없음"}
          </div>
          <p className="text-[11px] text-slate-500">
            Policy: {trace.policy.version} · workspaceMismatch=
            {String(trace.workspaceIdentity.workspaceMismatch)}
          </p>
        </section>
      )}
      {issues !== null && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="사업장명 또는 코드"
              className="h-8 w-44 text-xs"
            />
            <Select
              value={type}
              onChange={(event) => setType(event.target.value)}
              options={[
                { value: "all", label: "유형 전체" },
                ...types.map((value) => ({ value, label: value })),
              ]}
              className="h-8 w-44 text-xs"
            />
            <Select
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
              options={[
                { value: "all", label: "심각도 전체" },
                { value: "ERROR", label: "오류" },
                { value: "WARNING", label: "주의" },
                { value: "REVIEW", label: "확인필요" },
                { value: "NORMAL", label: "정상" },
              ]}
              className="h-8 w-28 text-xs"
            />
            <Select
              value={scope}
              onChange={(event) => setScope(event.target.value)}
              options={[
                { value: "abnormal", label: "이상건" },
                { value: "all", label: "전체" },
              ]}
              className="h-8 w-24 text-xs"
            />
            <span className="ml-auto text-xs text-slate-500">{visible.length}건</span>
          </div>
          <div className="max-h-[calc(100vh-230px)] overflow-auto rounded-lg border border-slate-200 bg-white">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-slate-50">
                <TableRow>
                  <TableHead>심각도</TableHead>
                  <TableHead>사업장</TableHead>
                  <TableHead>코드</TableHead>
                  <TableHead>점검유형</TableHead>
                  <TableHead>현재값</TableHead>
                  <TableHead>기준값</TableHead>
                  <TableHead>상태</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((issue, index) => (
                  <TableRow key={`${issue.code}-${issue.type}-${index}`}>
                    <TableCell>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[11px] font-semibold ${severityClass[issue.severity]}`}
                      >
                        {issue.severity === "ERROR"
                          ? "오류"
                          : issue.severity === "WARNING"
                            ? "주의"
                            : issue.severity === "NORMAL"
                              ? "정상"
                              : "확인"}
                      </span>
                    </TableCell>
                    <TableCell title={issue.businessName} className="max-w-40 truncate">
                      {issue.businessName}
                    </TableCell>
                    <TableCell>{issue.code}</TableCell>
                    <TableCell>{issue.type}</TableCell>
                    <TableCell title={issue.currentValue} className="max-w-48 truncate">
                      {issue.currentValue}
                    </TableCell>
                    <TableCell title={issue.referenceValue} className="max-w-48 truncate">
                      {issue.referenceValue}
                    </TableCell>
                    <TableCell>{issue.status}</TableCell>
                  </TableRow>
                ))}
                {visible.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-500">
                      {scope === "abnormal"
                        ? "이상 항목이 없습니다. 전체를 선택하면 정상 항목을 확인할 수 있습니다."
                        : "현재 필터에 맞는 항목이 없습니다."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}
      {issues === null && !error && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
          자동 조회하지 않습니다. 점검 실행을 눌러 읽기 전용 결과를 확인하세요.
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      )}
    </div>
  );
}
