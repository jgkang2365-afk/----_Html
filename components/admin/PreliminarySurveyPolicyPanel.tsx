"use client";

import { useEffect, useState } from "react";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { getKSTYear } from "@/lib/utils/date-utils";

type Policy = {
  enabled: boolean;
  effective_start_year: number | null;
  effective_start_period: "상반기" | "하반기" | null;
  effective_start_measurement_date: string | null;
};

const emptyPolicy: Policy = {
  enabled: false,
  effective_start_year: null,
  effective_start_period: null,
  effective_start_measurement_date: null,
};

// KST 기준 현재 연도를 중심으로 -2 ~ +4 범위의 연도 목록을 제공한다.
// DB에 저장된 기존 연도가 범위 밖이라도 선택·표시할 수 있도록 해당 연도를 포함한다.
const getEffectiveStartYearOptions = (storedYear: number | null): number[] => {
  const currentKstYear = getKSTYear();
  const options = Array.from({ length: 7 }, (_, index) => currentKstYear - 2 + index);
  if (storedYear !== null && !options.includes(storedYear)) {
    options.push(storedYear);
    options.sort((left, right) => left - right);
  }
  return options;
};

interface PreliminarySurveyPolicyPanelProps {
  isAdmin: boolean;
  userLoading: boolean;
}

export function PreliminarySurveyPolicyPanel({
  isAdmin,
  userLoading,
}: PreliminarySurveyPolicyPanelProps) {
  const [policy, setPolicy] = useState<Policy>(emptyPolicy);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (userLoading) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch("/api/admin/preliminary-survey-policy", {
          cache: "no-store",
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "정책을 불러오지 못했습니다.");
        setPolicy({
          enabled: result.policy.enabled,
          effective_start_year: result.policy.effective_start_year,
          effective_start_period: result.policy.effective_start_period,
          effective_start_measurement_date: result.policy.effective_start_measurement_date,
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "정책을 불러오지 못했습니다.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [isAdmin, userLoading]);

  const updatePolicy = <K extends keyof Policy>(key: K, value: Policy[K]) => {
    setPolicy((current) => ({ ...current, [key]: value }));
    setSuccess(null);
  };

  const save = async () => {
    if (policy.enabled && (
      policy.effective_start_year === null ||
      policy.effective_start_period === null ||
      policy.effective_start_measurement_date === null
    )) {
      setError("정책을 ON으로 저장하려면 적용 시작 연도, 주기, 측정일을 모두 입력해야 합니다.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      const response = await fetch("/api/admin/preliminary-survey-policy", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "정책을 저장하지 못했습니다.");
      setPolicy({
        enabled: result.policy.enabled,
        effective_start_year: result.policy.effective_start_year,
        effective_start_period: result.policy.effective_start_period,
        effective_start_measurement_date: result.policy.effective_start_measurement_date,
      });
      setSuccess("정책이 저장되었습니다.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "정책을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (!userLoading && !isAdmin) {
    return (
      <Card className="p-6">
        <h2 className="text-xl font-bold text-text-900">공정변경 예비조사 적용</h2>
        <Alert variant="error" className="mt-4">
          정책 조회 및 변경은 관리자만 할 수 있습니다.
        </Alert>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-text-900">공정변경 예비조사 적용</h2>
          <p className="mt-1 text-sm text-text-700">
            공정변경 정보의 저장·관리는 정책 상태와 관계없이 계속할 수 있습니다.
          </p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${policy.enabled ? "bg-success-50 text-success-700" : "bg-surface-100 text-text-700"}`}>
          {policy.enabled ? "ON" : "OFF"}
        </span>
      </div>

      <div className="mt-5 space-y-3 rounded-lg border border-surface-100 bg-surface-50 p-4 text-sm text-text-700">
        <p><strong>OFF:</strong> 공정변경 정보는 저장·관리되지만 예비조사 추천에는 반영되지 않습니다.</p>
        <p><strong>ON:</strong> 설정된 적용 시작 기준 이후부터 예비조사 추천에서 정책이 적용됩니다.</p>
        <p>정책 ON/OFF 변경만으로 과거 예비조사 계획을 자동 재계산하지 않습니다.</p>
      </div>

      {error && <Alert variant="error" className="mt-4">{error}</Alert>}
      {success && <Alert variant="success" className="mt-4">{success}</Alert>}

      {loading ? (
        <p className="mt-6 text-sm text-text-500">정책을 불러오는 중입니다.</p>
      ) : (
        <div className="mt-6 space-y-5">
          <label className="flex items-center gap-3 text-sm font-semibold text-text-900">
            <input
              type="checkbox"
              checked={policy.enabled}
              onChange={(event) => updatePolicy("enabled", event.target.checked)}
              disabled={saving}
              className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
            />
            공정변경 예비조사 정책 사용
          </label>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-text-700">적용 시작 연도</label>
              <select
                value={policy.effective_start_year ?? getKSTYear()}
                disabled={!policy.enabled || saving}
                onChange={(event) => updatePolicy(
                  "effective_start_year",
                  event.target.value === "" ? null : Number(event.target.value),
                )}
                className="h-10 w-full rounded-lg border border-surface-100 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-surface-50 disabled:text-text-500"
              >
                {getEffectiveStartYearOptions(policy.effective_start_year).map((year) => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-text-700">적용 시작 주기</label>
              <select
                value={policy.effective_start_period ?? ""}
                disabled={!policy.enabled || saving}
                onChange={(event) => updatePolicy(
                  "effective_start_period",
                  event.target.value === "상반기" || event.target.value === "하반기" ? event.target.value : null,
                )}
                className="h-10 w-full rounded-lg border border-surface-100 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-surface-50 disabled:text-text-500"
              >
                <option value="">선택</option>
                <option value="상반기">상반기</option>
                <option value="하반기">하반기</option>
              </select>
            </div>
            <Input
              type="date"
              label="적용 시작 측정일"
              value={policy.effective_start_measurement_date ?? ""}
              disabled={!policy.enabled || saving}
              onChange={(event) => updatePolicy("effective_start_measurement_date", event.target.value || null)}
            />
          </div>

          {!policy.enabled && (
            <p className="text-sm text-text-500">OFF 상태에서는 적용 시작값이 비어 있어도 정상입니다.</p>
          )}

          <div className="flex justify-end">
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? "저장 중..." : "정책 저장"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
