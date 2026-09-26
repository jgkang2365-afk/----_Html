import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";
import {
  buildPersonAssignmentRows,
  filterPersonAssignmentRows,
  type PersonAssignmentRole,
} from "@/lib/preliminary-survey-v2/person-assignment-view";

export const dynamic = "force-dynamic";

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function GET(request: NextRequest) {
  try {
    await checkPermission("survey:read");
    const params = new URL(request.url).searchParams;
    const startDate = params.get("startDate") ?? "";
    const endDate = params.get("endDate") ?? "";
    if (!isDateOnly(startDate) || !isDateOnly(endDate) || startDate > endDate) {
      return NextResponse.json({ error: "조회 기간이 올바르지 않습니다." }, { status: 400 });
    }
    const employeeId = Number(params.get("employeeId") || 0) || null;
    const roleParam = params.get("role") ?? "";
    const role: PersonAssignmentRole | "" = roleParam === "measurement_assignee" || roleParam === "preliminary_surveyor"
      ? roleParam : "";
    const search = params.get("search") ?? "";
    const supabase = await createClient();

    const [surveyPlanResult, rangedAssignmentResult, userResult] = await Promise.all([
      supabase.from("preliminary_survey_v2_plans")
        .select("id, measurement_target_business_id, recommended_date, participant_user_ids, participant_names, survey_method")
        .gte("recommended_date", startDate).lte("recommended_date", endDate),
      supabase.from("preliminary_survey_v2_measurement_assignments")
        .select("plan_id, measurement_date, assignee_user_id, public_sample_code")
        .gte("measurement_date", startDate).lte("measurement_date", endDate),
      supabase.from("users").select("id, name, is_active").eq("job", "측정"),
    ]);
    if (surveyPlanResult.error || rangedAssignmentResult.error || userResult.error) {
      throw surveyPlanResult.error || rangedAssignmentResult.error || userResult.error;
    }

    const planIds = new Set<string>((surveyPlanResult.data ?? []).map((plan: any) => String(plan.id)));
    for (const assignment of rangedAssignmentResult.data ?? []) planIds.add(String((assignment as any).plan_id));
    const missingPlanIds = [...planIds].filter((id) =>
      !(surveyPlanResult.data ?? []).some((plan: any) => String(plan.id) === id),
    );
    const missingPlanResult = missingPlanIds.length
      ? await supabase.from("preliminary_survey_v2_plans")
        .select("id, measurement_target_business_id, recommended_date, participant_user_ids, participant_names, survey_method")
        .in("id", missingPlanIds)
      : { data: [], error: null };
    if (missingPlanResult.error) throw missingPlanResult.error;
    const plans = [...(surveyPlanResult.data ?? []), ...(missingPlanResult.data ?? [])];
    const allPlanIds = plans.map((plan: any) => String(plan.id));
    const [assignmentResult, targetResult] = await Promise.all([
      allPlanIds.length
        ? supabase.from("preliminary_survey_v2_measurement_assignments")
          .select("plan_id, measurement_date, assignee_user_id, public_sample_code").in("plan_id", allPlanIds)
        : Promise.resolve({ data: [], error: null }),
      plans.length
        ? supabase.from("measurement_target_business").select("id, code, business_name, address")
          .in("id", [...new Set(plans.map((plan: any) => Number(plan.measurement_target_business_id)))])
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (assignmentResult.error || targetResult.error) throw assignmentResult.error || targetResult.error;

    const rows = filterPersonAssignmentRows(buildPersonAssignmentRows({
      targets: (targetResult.data ?? []) as any,
      plans: plans as any,
      assignments: (assignmentResult.data ?? []) as any,
      users: (userResult.data ?? []) as any,
    }), { startDate, endDate, employeeId, role, search });
    return NextResponse.json({
      rows,
      users: (userResult.data ?? []).map((user: any) => ({ id: Number(user.id), name: String(user.name ?? "") })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "개인별 배정 현황 조회 실패";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
