"use client";

import React, { FormEvent, useMemo, useState } from "react";

type ResyncAction = {
  date: string;
  eventId: string;
  action: "updated" | "created" | "recreated";
};

type ResyncResponse = {
  success: boolean;
  error?: string;
  code?: string;
  details?: {
    expectedDates?: string[];
    surveyDates?: string[];
  };
  business?: {
    code: string;
    year: number;
    period: string;
    name: string;
  };
  actions?: ResyncAction[];
};

const ACTION_LABELS: Record<ResyncAction["action"], string> = {
  updated: "기존 일정 갱신",
  created: "일정 신규 생성",
  recreated: "삭제 일정 재생성",
};

export const CalendarResyncAdminPanel: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const defaultPeriod = new Date().getMonth() < 6 ? "상반기" : "하반기";
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [year, setYear] = useState(String(currentYear));
  const [period, setPeriod] = useState(defaultPeriod);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ResyncResponse | null>(null);

  const canSubmit = useMemo(
    () => Boolean(code.trim()) && /^\d{4}$/.test(year) && !loading,
    [code, year, loading],
  );

  const close = () => {
    if (loading) return;
    setOpen(false);
    setResult(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/businesses/calendar-resync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim().toUpperCase(),
          year: Number(year),
          period,
        }),
      });
      const payload = (await response.json()) as ResyncResponse;
      setResult(payload);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "캘린더 재동기화 요청에 실패했습니다.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-lg hover:bg-slate-50"
      >
        캘린더 재동기화
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">캘린더 재동기화</h2>
                <p className="mt-1 text-xs text-slate-500">
                  측정대상사업장·예비조사 원천이 일치할 때만 Google Calendar를 강제로 복구합니다.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                disabled={loading}
                className="rounded px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
                aria-label="닫기"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-xs font-semibold text-slate-600">
                  사업장 코드
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    placeholder="예: H0527"
                    className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-sm uppercase focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  측정년도
                  <input
                    value={year}
                    onChange={(event) => setYear(event.target.value.replace(/\D/g, "").slice(0, 4))}
                    inputMode="numeric"
                    className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">
                  측정주기
                  <select
                    value={period}
                    onChange={(event) => setPeriod(event.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-slate-300 px-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="상반기">상반기</option>
                    <option value="상반기(수시)">상반기(수시)</option>
                    <option value="하반기">하반기</option>
                    <option value="하반기(수시)">하반기(수시)</option>
                  </select>
                </label>
              </div>

              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                일반 저장의 자동 동기화를 대체하지 않는 관리자 복구 기능입니다. 원천 데이터가 서로 다르면 캘린더를 건드리지 않고 중단합니다.
              </div>

              {result && (
                <div
                  className={`rounded-md border px-3 py-3 text-sm ${
                    result.success
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-red-200 bg-red-50 text-red-800"
                  }`}
                >
                  {result.success ? (
                    <div className="space-y-2">
                      <div className="font-semibold">
                        {result.business?.code} {result.business?.name} 재동기화 완료
                      </div>
                      {(result.actions || []).length > 0 ? (
                        <ul className="space-y-1 text-xs">
                          {(result.actions || []).map((action) => (
                            <li key={`${action.date}-${action.eventId}`}>
                              {action.date} · {ACTION_LABELS[action.action]}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-xs">변경할 캘린더 일정이 없습니다.</div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="font-semibold">재동기화 실패</div>
                      <div className="text-xs leading-5">{result.error || "알 수 없는 오류"}</div>
                      {result.code === "CALENDAR_SOURCE_MISMATCH" && result.details && (
                        <div className="mt-2 text-xs">
                          측정대상: {(result.details.expectedDates || []).join(", ") || "없음"}
                          <br />
                          예비조사: {(result.details.surveyDates || []).join(", ") || "없음"}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={loading}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                >
                  닫기
                </button>
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? "재동기화 중..." : "강제 재동기화"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
