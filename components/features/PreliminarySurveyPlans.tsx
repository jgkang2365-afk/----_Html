"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";

const STATUS_LABELS: Record<string, string> = {
  pending: "추천 대기",
  recommended: "추천 완료",
  confirmed: "확정",
  needs_review: "재검토 필요",
  cancelled: "취소",
};

const REASON_LABELS: Record<string, string> = {
  RECOMMENDATION_CREATED: "현장방문 일정으로 추천했습니다.",
  EXISTING_VISIT_RECOMMENDATION_CREATED: "기존업체를 방문하는 일정으로 추천했습니다. 유선 파악도 가능합니다.",
  MEASURER_REQUIRED: "보고서 담당자가 필요합니다.",
  MEASUREMENT_DATE_REQUIRED: "측정예정일이 필요합니다.",
  ADDRESS_REQUIRED: "주소가 필요합니다.",
  ADDRESS_REGION_UNAVAILABLE: "주소에서 시·군·구를 확인할 수 없습니다.",
  NO_AVAILABLE_EXPERIENCED_USER: "가용한 동행 경력자가 없습니다.",
  NO_AVAILABLE_DATE: "1~30워킹데이 안에 가능한 날짜가 없습니다.",
  MEASURER_CHANGED: "보고서 담당자가 변경되었습니다.",
  MEASUREMENT_DATE_CHANGED: "측정예정일이 변경되었습니다.",
  ADDRESS_CHANGED: "주소가 변경되었습니다.",
  RULE_TYPE_CHANGED: "예비조사 대상 구분이 변경되었습니다.",
  USER_SCHEDULE_BLOCK_CONFLICT: "직원 제외 일정과 겹칩니다.",
  EXPERIENCED_USER_UNAVAILABLE: "동행 경력자의 자격 또는 활성 상태가 변경되었습니다.",
  RESPONSIBLE_USER_UNAVAILABLE: "담당자의 활성 상태 또는 직무가 변경되었습니다.",
  WORKING_DAY_RANGE_CHANGED: "현재 측정일 기준 1~30워킹데이 범위를 벗어납니다.",
  DIFFERENT_REGION_MEASUREMENT_CONFLICT: "다른 지역 측정 일정과 겹칩니다.",
  RESPONSIBLE_EXPERIENCE_CHANGED: "담당자의 예비조사 경력자 자격이 변경되었습니다.",
  HOLIDAY_DATA_REVIEW_REQUIRED: "공휴일 데이터를 관리자 확인해야 합니다.",
  SAME_REGION_SCHEDULE_TIME_CHECK_REQUIRED: "같은 지역 측정 일정의 시간을 확인해야 합니다.",
  UNKNOWN_REGION_SCHEDULE_CHECK_REQUIRED: "권역을 확인할 수 없는 측정 일정이 있습니다.",
};

const RULE_LABELS: Record<string, string> = {
  existing: "기존업체",
  general_new: "일반 신규",
  other_org_new: "타기관 신규",
  unconfirmed_new: "신규 유형 미확정",
};

interface Plan {
  id: string;
  status: string;
  row_version: number;
  recommended_date: string | null;
  confirmed_date: string | null;
  visit_mode: string | null;
  responsible_user_name: string | null;
  responsible_user_experienced: boolean;
  experienced_user_name: string | null;
  recommendation_reason: Record<string, any>;
  recommendation_score: number | null;
  warnings: string[];
  review_reasons: string[];
  holiday_verification_status: string;
  alternatives: Array<{
    date?: string;
    experiencedUserName?: string | null;
    warnings?: string[];
  }>;
  target: {
    id: number;
    code: string;
    business_name: string;
    address: string | null;
    measurement_date: string | null;
    preliminary_survey_rule_type: string;
  } | null;
}

export function PreliminarySurveyPlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDates, setConfirmDates] = useState<Record<string, string>>({});
  const [holidayOverrideReasons, setHolidayOverrideReasons] = useState<
    Record<string, string>
  >({});

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const targetId =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("targetId")
          : null;
      const response = await fetch(
        `/api/preliminary-survey-plans${targetId ? `?targetId=${targetId}` : ""}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "계획 조회 실패");
      setPlans(result.plans || []);
      setConfirmDates(
        Object.fromEntries(
          (result.plans || []).map((plan: Plan) => [
            plan.id,
            plan.confirmed_date || plan.recommended_date || "",
          ]),
        ),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "계획 조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const recommend = async (plan: Plan) => {
    const replaceConfirmed = plan.status === "confirmed";
    if (
      replaceConfirmed &&
      !window.confirm("기존 확정 정보를 취소하고 다시 추천하시겠습니까?")
    ) {
      return;
    }
    const response = await fetch("/api/preliminary-survey-plans/recommend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        measurementTargetBusinessId: plan.target?.id,
        replaceConfirmed,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "추천 실패");
    await loadPlans();
  };

  const confirmPlan = async (plan: Plan) => {
    const response = await fetch(
      `/api/preliminary-survey-plans/${plan.id}/confirm`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmedDate: confirmDates[plan.id],
          expectedRowVersion: plan.row_version,
          holidayVerificationOverrideReason:
            holidayOverrideReasons[plan.id] || "",
        }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "확정 실패");
    await loadPlans();
  };

  const cancelPlan = async (plan: Plan) => {
    if (!window.confirm("이 예비조사 계획을 취소하시겠습니까?")) return;
    const response = await fetch(
      `/api/preliminary-survey-plans/${plan.id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRowVersion: plan.row_version }),
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "취소 실패");
    await loadPlans();
  };

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "처리 중 오류가 발생했습니다.");
    }
  };

  if (loading) return <div className="flex h-48 items-center justify-center"><LoadingSpinner /></div>;

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}
      {plans.length === 0 ? (
        <Card className="p-10 text-center text-slate-500">
          생성된 예비조사 계획이 없습니다. 사업장에 담당자와 측정예정일을 저장하면 자동 추천됩니다.
        </Card>
      ) : (
        plans.map((plan) => {
          const reasonCode = String(plan.recommendation_reason?.code || "");
          return (
            <Card key={plan.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold">{plan.target?.business_name || "사업장"}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                      plan.status === "needs_review"
                        ? "bg-red-100 text-red-700"
                        : plan.status === "confirmed"
                          ? "bg-green-100 text-green-700"
                          : "bg-blue-100 text-blue-700"
                    }`}>
                      {STATUS_LABELS[plan.status] || plan.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{plan.target?.address || "주소 없음"}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => void run(() => recommend(plan))}>
                    {plan.status === "needs_review" ? "다시 추천" : "재추천"}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void run(() => cancelPlan(plan))}>취소</Button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                <div><span className="text-slate-500">예비조사 대상 구분</span><div className="font-semibold">{RULE_LABELS[plan.target?.preliminary_survey_rule_type || ""] || "-"}</div></div>
                <div><span className="text-slate-500">측정예정일</span><div className="font-semibold">{plan.target?.measurement_date || "-"}</div></div>
                <div><span className="text-slate-500">추천일</span><div className="font-semibold">{plan.recommended_date || "-"}</div></div>
                <div><span className="text-slate-500">조사 방식</span><div className="font-semibold">{plan.visit_mode === "existing_field_visit" ? "방문 가정(유선 가능)" : plan.visit_mode === "experienced_solo_visit" ? "경력자 단독 방문" : plan.visit_mode === "joint_field_visit" ? "공동 방문" : "-"}</div></div>
                <div><span className="text-slate-500">담당자</span><div className="font-semibold">{plan.responsible_user_name || "-"} {plan.responsible_user_name ? `(${plan.responsible_user_experienced ? "경력자" : "미경력"})` : ""}</div></div>
                <div><span className="text-slate-500">동행 경력자</span><div className="font-semibold">{plan.experienced_user_name || "-"}</div></div>
                <div><span className="text-slate-500">추천 점수</span><div className="font-semibold">{plan.recommendation_score ?? "-"}</div></div>
              </div>

              {plan.target?.preliminary_survey_rule_type === "existing" && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                  기존업체는 유선으로 파악할 수 있지만, 날짜 중복을 피하기 위해 방문 일정으로 가정하여 추천합니다.
                </div>
              )}

              {(reasonCode || plan.review_reasons?.length > 0 || plan.warnings?.length > 0) && (
                <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                  {reasonCode && <div>{REASON_LABELS[reasonCode] || reasonCode}</div>}
                  {plan.review_reasons?.map((reason) => (
                    <div key={reason}>{REASON_LABELS[reason] || reason}</div>
                  ))}
                  {plan.warnings?.map((warning) => <div key={warning}>주의: {REASON_LABELS[warning] || warning}</div>)}
                </div>
              )}

              {plan.alternatives?.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 text-sm font-bold text-slate-700">대안 후보</div>
                  <div className="flex flex-wrap gap-2">
                    {plan.alternatives.map((alternative, index) => (
                      <button
                        type="button"
                        key={`${alternative.date}-${index}`}
                        className="rounded border border-slate-200 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
                        onClick={() =>
                          setConfirmDates((previous) => ({
                            ...previous,
                            [plan.id]: alternative.date || "",
                          }))
                        }
                      >
                        {alternative.date} · {alternative.experiencedUserName || plan.responsible_user_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {plan.status === "recommended" && (
                <div className="mt-4 flex flex-wrap items-end justify-end gap-2 border-t pt-4">
                  {plan.holiday_verification_status === "incomplete" && (
                    <Input
                      label="공휴일 직접 확인 사유"
                      value={holidayOverrideReasons[plan.id] || ""}
                      onChange={(event) =>
                        setHolidayOverrideReasons((previous) => ({
                          ...previous,
                          [plan.id]: event.target.value,
                        }))
                      }
                      placeholder="관리자가 확인한 근거를 입력하세요"
                    />
                  )}
                  <Input
                    type="date"
                    label="확정일"
                    value={confirmDates[plan.id] || ""}
                    onChange={(event) =>
                      setConfirmDates((previous) => ({
                        ...previous,
                        [plan.id]: event.target.value,
                      }))
                    }
                  />
                  <Button onClick={() => void run(() => confirmPlan(plan))}>확정</Button>
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
