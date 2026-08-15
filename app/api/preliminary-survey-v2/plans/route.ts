import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";

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
    let planQuery = supabase
      .from("preliminary_survey_v2_plans")
      .select(
        "id, measurement_target_business_id, recommended_date, responsible_user_id, experienced_reviewer_id, participant_user_ids, participant_names, status, plan_origin, source_measurement_date, source_rule_type, survey_method, recommendation_reason, route_evidence, warnings, created_at, updated_at",
      )
      .in("status", ["recommended", "manual_required"])
      .order("recommended_date", { ascending: true, nullsFirst: false })
      .order("updated_at", { ascending: false });
    if (targetId) {
      planQuery = planQuery.eq("measurement_target_business_id", targetId);
    }

    const { data: planRows, error: planError } = await planQuery;
    if (planError) {
      const schemaMissing = ["42P01", "PGRST205"].includes(planError.code || "");
      return NextResponse.json(
        { error: schemaMissing ? "V2_SCHEMA_NOT_READY" : planError.message },
        { status: schemaMissing ? 503 : 500 },
      );
    }

    const plans = planRows || [];
    const targetIds = [
      ...new Set(plans.map((plan) => Number(plan.measurement_target_business_id))),
    ];
    const userIds = [
      ...new Set(
        plans
          .flatMap((plan) => [plan.responsible_user_id, plan.experienced_reviewer_id])
          .filter((id): id is number => Number.isInteger(id)),
      ),
    ];
    const [{ data: targets, error: targetError }, { data: users, error: userError }] =
      await Promise.all([
        targetIds.length
          ? supabase
              .from("measurement_target_business")
              .select("id, code, business_name, address, measurement_date")
              .in("id", targetIds)
          : Promise.resolve({ data: [], error: null }),
        userIds.length
          ? supabase.from("users").select("id, name").in("id", userIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
    if (targetError) throw targetError;
    if (userError) throw userError;

    const targetMap = new Map(
      (targets || []).map((target) => [Number(target.id), target]),
    );
    const userMap = new Map((users || []).map((user) => [Number(user.id), user.name]));

    return NextResponse.json({
      plans: plans.map((plan) => ({
        ...plan,
        responsible_user_name: userMap.get(Number(plan.responsible_user_id)) || null,
        experienced_reviewer_name: plan.experienced_reviewer_id
          ? userMap.get(Number(plan.experienced_reviewer_id)) || null
          : null,
        target: targetMap.get(Number(plan.measurement_target_business_id)) || null,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "V2_PLAN_QUERY_FAILED";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
