import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  calculateV2Recommendations,
  persistV2Recommendations,
} from "@/lib/preliminary-survey-v2/service";
import { v2BusinessKindLabel } from "@/lib/preliminary-survey-v2/presentation";
import { recommendationDatesForBusinessType } from "@/lib/preliminary-survey-v2/calendar";

export const dynamic = "force-dynamic";

function normalizedPeriod(value: unknown) {
  return String(value ?? "").trim().replace("(수시)", "");
}

function journalKey(code: unknown, year: unknown, period: unknown) {
  return `${code}|${Number(year)}|${normalizedPeriod(period)}`;
}

async function requireSurveyAccess() {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function GET(request: NextRequest) {
  try {
    await requireSurveyAccess();
    const params = new URL(request.url).searchParams;
    const year = Number(params.get("year") || new Date().getFullYear());
    const period = params.get("period") || "";
    const supabase = await createClient();

    let targetQuery = supabase.from("measurement_target_business").select(
      "id, code, year, period, business_name, address, measurement_date, business_type, preliminary_survey_rule_type, collaborators, daily_staff, measurer_id, link_measurer_id",
    ).eq("year", year).order("measurement_date", { ascending: true });
    if (period) targetQuery = targetQuery.eq("period", period);
    const { data: targets, error: targetError } = await targetQuery;
    if (targetError) throw targetError;

    const targetIds = (targets ?? []).map((target: any) => Number(target.id));
    const codes = [...new Set((targets ?? []).map((target: any) => target.code))];
    const [{ data: plans, error: planError }, { data: journals, error: journalError }, { data: users, error: userError }] = await Promise.all([
      targetIds.length
        ? supabase.from("preliminary_survey_v2_plans").select("*").in("measurement_target_business_id", targetIds)
        : Promise.resolve({ data: [], error: null }),
      codes.length
        ? supabase.from("measurement_journal").select("id, code, measurement_year, measurement_period").in("code", codes)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("users").select("id, name, is_active, is_preliminary_survey_experienced, job").eq("job", "측정"),
    ]);
    if (planError || journalError || userError) throw planError || journalError || userError;

    const planByTarget = new Map((plans ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
    const userNameById = new Map((users ?? []).map((user: any) => [Number(user.id), user.name]));
    const confirmedKeys = new Set((journals ?? []).map((row: any) =>
      journalKey(row.code, row.measurement_year, row.measurement_period),
    ));

    const rows = (targets ?? []).map((target: any) => {
      const plan: any = planByTarget.get(Number(target.id)) ?? null;
      const trueConfirmed = confirmedKeys.has(journalKey(target.code, target.year, target.period));
      const stale = Boolean(plan && plan.source_measurement_date !== target.measurement_date);
      const status = trueConfirmed
        ? "true_confirmed"
        : stale || plan?.plan_origin === "automatic"
          ? "review_required"
          : plan?.status === "manual_required"
            ? "adjustment_required"
            : plan ? "provisional" : "unassigned";
      const kind = target.business_type === "external_new"
        ? "타기관 신규"
        : target.business_type === "first_measurement"
          ? "최초실시"
          : target.business_type === "existing"
            ? "기존업체"
            : v2BusinessKindLabel(plan?.source_rule_type ?? target.preliminary_survey_rule_type ?? "existing", plan?.recommendation_reason ?? null);
      const staff = Array.isArray(target.collaborators)
        ? target.collaborators.map(String)
        : String(target.collaborators ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      return {
        targetId: Number(target.id),
        code: target.code,
        businessName: target.business_name,
        address: target.address,
        year: Number(target.year),
        period: target.period,
        kind,
        measurementDate: target.measurement_date,
        preliminaryDate: plan?.recommended_date ?? null,
        surveyors: Array.isArray(plan?.participant_names) ? plan.participant_names : [],
        surveyMethod: plan?.survey_method ?? (kind === "기존업체" ? "phone" : "field"),
        mainMeasurer: staff[0] ?? "-",
        helper: staff.slice(1).join(", ") || "-",
        reportWriter: userNameById.get(Number(target.measurer_id)) ?? "-",
        status,
        conflict: stale ? "측정예정일 변경" : plan?.status === "manual_required" ? "조정 필요" : null,
        planOrigin: plan?.plan_origin ?? null,
        locked: trueConfirmed,
      };
    });
    return NextResponse.json({ rows, users: users ?? [], year, period });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKBENCH_QUERY_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSurveyAccess();
    if (session.role !== "관리자") {
      return NextResponse.json({ error: "관리자만 추천안을 생성·적용할 수 있습니다." }, { status: 403 });
    }
    const body = await request.json();
    const action = body.action === "apply" ? "apply" : "recommend";
    const targetIds: number[] = Array.isArray(body.targetIds)
      ? [...new Set<number>(body.targetIds.map(Number).filter((value: number) => Number.isInteger(value)))]
      : [];
    const supabase = await createClient();
    let candidateQuery = supabase.from("measurement_target_business").select("id, code, year, period, measurement_date");
    if (targetIds.length) {
      candidateQuery = candidateQuery.in("id", targetIds);
    } else {
      candidateQuery = candidateQuery.eq("year", Number(body.year || new Date().getFullYear()));
      if (body.period) candidateQuery = candidateQuery.eq("period", String(body.period));
    }
    const { data: candidateRows, error: candidateError } = await candidateQuery;
    if (candidateError) throw candidateError;
    const candidateCodes = [...new Set((candidateRows ?? []).map((row: any) => row.code))];
    const candidateIds = (candidateRows ?? []).map((row: any) => Number(row.id));
    const [{ data: journalRows, error: journalError }, { data: planRows, error: planError }] = await Promise.all([
      candidateCodes.length
        ? supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", candidateCodes)
        : Promise.resolve({ data: [], error: null }),
      candidateIds.length
        ? supabase.from("preliminary_survey_v2_plans").select("measurement_target_business_id, plan_origin, source_measurement_date").in("measurement_target_business_id", candidateIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (journalError || planError) throw journalError || planError;
    const confirmedKeys = new Set((journalRows ?? []).map((row: any) => journalKey(row.code, row.measurement_year, row.measurement_period)));
    const planByTarget = new Map((planRows ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
    const eligibleTargetIds = (candidateRows ?? []).filter((row: any) => {
      if (confirmedKeys.has(journalKey(row.code, row.year, row.period))) return false;
      if (targetIds.length) return true;
      const plan: any = planByTarget.get(Number(row.id));
      return !plan || plan.plan_origin !== "manual" || plan.source_measurement_date !== row.measurement_date;
    }).map((row: any) => Number(row.id));
    if (!eligibleTargetIds.length) {
      return NextResponse.json({ success: true, drafts: [], missing: [], scope: targetIds.length === 1 ? "target_business" : "range", impactSummary: "변경 가능한 대상이 없습니다." });
    }
    const output = await calculateV2Recommendations(supabase, {
      targetIds: eligibleTargetIds,
    });

    if (action === "apply") {
      if (!targetIds.length) return NextResponse.json({ error: "적용할 추천안이 없습니다." }, { status: 400 });
      const plans = await persistV2Recommendations(supabase, output, { planOrigin: "manual" });
      return NextResponse.json({ success: true, appliedCount: plans.length });
    }

    return NextResponse.json({
      success: true,
      drafts: output.results.map((result) => {
        const target = output.targets.find((item) => item.id === result.targetId)!;
        return {
          targetId: result.targetId,
          code: target.code,
          businessName: target.name,
          kind: target.businessType === "external_new" ? "타기관 신규" : target.businessType === "first_measurement" ? "최초실시" : "기존업체",
          measurementDate: target.measurementDate,
          preliminaryDate: result.date,
          surveyors: result.participants.map((user) => user.name),
          surveyMethod: result.surveyMethod,
          status: result.status === "recommended" ? "recommended" : "adjustment_required",
          conflict: result.status === "manual_required" ? result.reason : null,
          reason: result.reason,
          alternatives: recommendationDatesForBusinessType(
            target.measurementDate,
            target.businessType ?? (target.kind === "existing" ? "existing" : "first_measurement"),
          ).map((item) => item.date).filter((date) => date !== result.date).slice(0, 3),
        };
      }),
      missing: output.missing,
      scope: targetIds.length === 1 ? "target_business" : "range",
      impactSummary: targetIds.length === 1 ? "기존 가확정은 유지하고 같은 날짜·관련 조사자 제약을 재검증했습니다." : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKBENCH_RECOMMEND_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
