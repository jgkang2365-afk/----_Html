import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";
import { recommendationDatesForBusinessType } from "@/lib/preliminary-survey-v2/calendar";
import {
  checkPreliminarySurveyDatePolicy,
  preliminarySurveyDatePolicyMessage,
} from "@/lib/preliminary-survey-v2/policy-compliance";

export const dynamic = "force-dynamic";

function targetIdFrom(value: unknown) {
  const targetId = Number(value);
  return Number.isInteger(targetId) && targetId > 0 ? targetId : null;
}

async function guard() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  const supabase = await createClient();
  if (!await canManagePreliminarySurvey(supabase, session)) {
    return { response: NextResponse.json({ error: "예비조사 담당자 또는 관리자만 찐확정 repair를 수행할 수 있습니다." }, { status: 403 }) };
  }
  return { session, supabase };
}

async function loadRepairContext(supabase: any, targetId: number) {
  const { data: target, error: targetError } = await supabase.from("measurement_target_business").select(
    "id, code, year, period, business_name, measurement_date, business_type",
  ).eq("id", targetId).maybeSingle();
  if (targetError || !target) throw new Error("TARGET_NOT_FOUND");
  const [{ data: plan, error: planError }, { data: journals, error: journalError }] = await Promise.all([
    supabase.from("preliminary_survey_v2_plans").select("id, recommended_date").eq("measurement_target_business_id", targetId).maybeSingle(),
    supabase.from("measurement_journal").select("id, measurement_period").eq("code", target.code)
      .eq("measurement_year", target.year),
  ]);
  if (planError || journalError) throw planError || journalError;
  const normalizedPeriod = String(target.period ?? "").trim().replace("(수시)", "");
  if (!(journals ?? []).some((journal: any) => String(journal.measurement_period ?? "").trim().replace("(수시)", "") === normalizedPeriod)) {
    throw new Error("TRUE_CONFIRMED_REQUIRED");
  }
  const datePolicy = checkPreliminarySurveyDatePolicy({
    measurementDate: target.measurement_date,
    preliminaryDate: plan?.recommended_date,
    businessType: target.business_type,
  });
  if (datePolicy.compliant) throw new Error("POLICY_DATE_REPAIR_NOT_REQUIRED");
  if (!target.business_type || !target.measurement_date) throw new Error("POLICY_DATE_REPAIR_SOURCE_INCOMPLETE");
  return {
    target,
    plan,
    datePolicy,
    candidateDates: recommendationDatesForBusinessType(target.measurement_date, target.business_type).map((item) => item.date),
  };
}

export async function POST(request: NextRequest) {
  try {
    const access = await guard();
    if ("response" in access) return access.response;
    const body = await request.json();
    const targetId = targetIdFrom(body.targetId);
    if (!targetId) return NextResponse.json({ error: "INVALID_TARGET_ID" }, { status: 400 });
    const context = await loadRepairContext(access.supabase, targetId);
    if (body.action === "preview") {
      return NextResponse.json({
        success: true,
        targetId,
        code: context.target.code,
        businessName: context.target.business_name,
        currentRecommendedDate: context.plan?.recommended_date ?? null,
        candidateDates: context.candidateDates,
        policyIssues: context.datePolicy.issues,
        reason: preliminarySurveyDatePolicyMessage(context.datePolicy),
      });
    }
    const recommendedDate = String(body.recommendedDate ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    if (body.action !== "apply" || !context.plan?.id || !context.candidateDates.includes(recommendedDate) || !reason) {
      return NextResponse.json({ error: "INVALID_POLICY_DATE_REPAIR" }, { status: 400 });
    }
    const { error } = await access.supabase.rpc("repair_true_confirmed_preliminary_v2_policy_date", {
      p_target_id: targetId,
      p_expected_plan_id: context.plan.id,
      p_expected_source_measurement_date: context.target.measurement_date,
      p_expected_recommended_date: context.plan.recommended_date,
      p_recommended_date: recommendedDate,
      p_reason: reason,
      p_changed_by_user_id: access.session.userId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
    return NextResponse.json({ success: true, repairedFields: ["recommended_date"] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "POLICY_DATE_REPAIR_FAILED";
    return NextResponse.json({ error: message }, { status: message === "TRUE_CONFIRMED_REQUIRED" ? 409 : 500 });
  }
}
