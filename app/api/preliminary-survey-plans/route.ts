import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";
import {
  PlanView,
  refreshPlanReview,
} from "@/lib/preliminary-survey/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await checkPermission("survey:read");
    const targetIdText = new URL(request.url).searchParams.get("targetId");
    const targetId = targetIdText ? Number(targetIdText) : null;
    if (targetIdText && !Number.isInteger(targetId)) {
      return NextResponse.json({ error: "INVALID_TARGET_ID" }, { status: 400 });
    }

    const supabase = await createClient();
    let query = supabase
      .from("preliminary_survey_plans")
      .select("*")
      .order("updated_at", { ascending: false });
    if (targetId) query = query.eq("measurement_target_business_id", targetId);

    const { data, error } = await query;
    if (error) throw error;

    const refreshed: PlanView[] = [];
    for (const rawPlan of (data || []) as PlanView[]) {
      try {
        refreshed.push(await refreshPlanReview(supabase, rawPlan));
      } catch (reviewError) {
        console.error("[PreliminarySurvey] review refresh failed:", reviewError);
        refreshed.push(rawPlan);
      }
    }

    const targetIds = [
      ...new Set(refreshed.map((plan) => plan.measurement_target_business_id)),
    ];
    const userIds = [
      ...new Set(
        refreshed
          .flatMap((plan) => [plan.responsible_user_id, plan.experienced_user_id])
          .filter((id): id is number => Boolean(id)),
      ),
    ];
    const [{ data: targets }, { data: users }] = await Promise.all([
      targetIds.length
        ? supabase
            .from("measurement_target_business")
            .select(
              "id, code, year, period, business_name, address, measurement_date, daily_staff, measurer_id, preliminary_survey_rule_type, requires_field_preliminary_survey, updated_at",
            )
            .in("id", targetIds)
        : Promise.resolve({ data: [] as any[] }),
      userIds.length
        ? supabase
            .from("users")
            .select("id, name, is_preliminary_survey_experienced")
            .in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const targetMap = new Map((targets || []).map((target: any) => [target.id, target]));
    const userMap = new Map((users || []).map((user: any) => [user.id, user]));

    const plans = refreshed.map((plan) => ({
      ...plan,
      responsible_user_name: userMap.get(plan.responsible_user_id)?.name || null,
      responsible_user_experienced:
        userMap.get(plan.responsible_user_id)
          ?.is_preliminary_survey_experienced === true,
      experienced_user_name: plan.experienced_user_id
        ? userMap.get(plan.experienced_user_id)?.name || null
        : null,
      target: targetMap.get(plan.measurement_target_business_id) || null,
    }));

    return NextResponse.json({ plans });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PLAN_QUERY_FAILED";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
