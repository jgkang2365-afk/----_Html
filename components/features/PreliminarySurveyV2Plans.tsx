"use client";

import { useCallback, useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import {
  v2BusinessKindLabel,
  v2StatusLabel,
  v2SurveyMethodLabel,
  v2WarningLabel,
  type V2PlanStatus,
  type V2SurveyMethod,
} from "@/lib/preliminary-survey-v2/presentation";

interface V2Plan {
  id: string;
  recommended_date: string | null;
  participant_names: string[];
  status: V2PlanStatus;
  plan_origin: "automatic" | "manual";
  source_rule_type: string;
  survey_method: V2SurveyMethod;
  recommendation_reason: Record<string, unknown>;
  warnings: string[];
  responsible_user_name: string | null;
  experienced_reviewer_name: string | null;
  target: {
    code: string;
    business_name: string;
    address: string | null;
    measurement_date: string | null;
  } | null;
}

export function PreliminarySurveyV2Plans() {
  const [plans, setPlans] = useState<V2Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/preliminary-survey-v2/plans", {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.error === "V2_SCHEMA_NOT_READY"
            ? "V2 예비조사 저장소가 아직 준비되지 않았습니다."
            : result.error || "V2 계획 조회 실패",
        );
      }
      setPlans(result.plans || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "V2 계획 조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}
      {!error && plans.length === 0 ? (
        <Card className="p-10 text-center text-slate-500">
          현재 생성된 V2 예비조사 계획이 없습니다.
        </Card>
      ) : (
        plans.map((plan) => {
          const reason = String(plan.recommendation_reason?.reason || "");
          const participantNames = Array.isArray(plan.participant_names)
            ? plan.participant_names
            : [];
          return (
            <Card key={plan.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold">
                      {plan.target?.business_name || "사업장"}
                    </h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${plan.status === "manual_required" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                      {v2StatusLabel(plan.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {plan.target?.address || "주소 없음"}
                  </p>
                </div>
                <span className="text-xs text-slate-500">
                  {plan.plan_origin === "manual" ? "관리자 수정" : "자동추천"}
                </span>
              </div>

              <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
                <div><span className="text-slate-500">예비조사 대상 구분</span><div className="font-semibold">{v2BusinessKindLabel(plan.source_rule_type, plan.recommendation_reason)}</div></div>
                <div><span className="text-slate-500">측정예정일</span><div className="font-semibold">{plan.target?.measurement_date || "-"}</div></div>
                <div><span className="text-slate-500">추천일</span><div className="font-semibold">{plan.recommended_date || "미정"}</div></div>
                <div><span className="text-slate-500">담당자</span><div className="font-semibold">{plan.responsible_user_name || participantNames[0] || "-"}</div></div>
                <div><span className="text-slate-500">조사방식</span><div className="font-semibold">{v2SurveyMethodLabel(plan.survey_method)}</div></div>
                <div><span className="text-slate-500">{plan.survey_method === "field" ? "동행 경력자" : "검토 경력자"}</span><div className="font-semibold">{plan.experienced_reviewer_name || "-"}</div></div>
              </div>

              {(reason || plan.warnings.length > 0) && (
                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                  {reason && <div>{reason}</div>}
                  {plan.warnings.map((warning) => (
                    <div key={warning} className="mt-1 text-amber-700">주의: {v2WarningLabel(warning)}</div>
                  ))}
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
