import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  PlanView,
  validatePlanConfirmation,
} from "@/lib/preliminary-survey/service";

export async function POST(
  request: NextRequest,
  { params }: { params: { planId: string } },
) {
  try {
    await checkPermission("survey:write");
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const confirmedDate = String(body.confirmedDate || "");
    const holidayOverrideReason = String(
      body.holidayVerificationOverrideReason || "",
    ).trim();
    const expectedRowVersion = Number(body.expectedRowVersion);
    if (!confirmedDate || !Number.isInteger(expectedRowVersion)) {
      return NextResponse.json(
        { error: "CONFIRMED_DATE_AND_VERSION_REQUIRED" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const { data: plan, error: planError } = await supabase
      .from("preliminary_survey_plans")
      .select("*")
      .eq("id", params.planId)
      .single();
    if (planError || !plan) {
      return NextResponse.json({ error: "PLAN_NOT_FOUND" }, { status: 404 });
    }
    if (Number(plan.row_version) !== expectedRowVersion) {
      return NextResponse.json({ error: "PLAN_VERSION_CONFLICT" }, { status: 409 });
    }

    const validation = await validatePlanConfirmation(
      supabase,
      plan as PlanView,
      confirmedDate,
    );
    if (validation.warnings.includes("HOLIDAY_DATA_REVIEW_REQUIRED")) {
      if (session.role !== "관리자") {
        return NextResponse.json(
          { error: "HOLIDAY_OVERRIDE_ADMIN_REQUIRED" },
          { status: 403 },
        );
      }
      if (!holidayOverrideReason) {
        return NextResponse.json(
          { error: "HOLIDAY_OVERRIDE_REASON_REQUIRED" },
          { status: 400 },
        );
      }
    }
    const { data, error } = await supabase.rpc("confirm_preliminary_survey_plan", {
      p_plan_id: params.planId,
      p_expected_row_version: expectedRowVersion,
      p_confirmed_date: confirmedDate,
      p_actor_user_id: session.userId,
      p_holiday_override_reason: holidayOverrideReason || null,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({
      success: true,
      plan: (data || [])[0] || null,
      warnings: validation.warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PLAN_CONFIRM_FAILED";
    const validationErrors = [
      "INVALID_CONFIRMED_DATE",
      "NON_WORKING_DAY",
      "CONFIRMED_DATE_OUT_OF_RANGE",
      "PAST_PRELIMINARY_SURVEY_DATE",
      "DIFFERENT_REGION_MEASUREMENT_CONFLICT",
      "HOLIDAY_OVERRIDE_REASON_REQUIRED",
    ];
    const conflictErrors = [
      "PLAN_VERSION_CONFLICT",
      "PLAN_SOURCE_CHANGED",
      "PLAN_NOT_RECOMMENDED",
      "RESPONSIBLE_USER_UNAVAILABLE",
      "EXPERIENCED_USER_UNAVAILABLE",
      "USER_SCHEDULE_BLOCK_CONFLICT",
    ];
    const status =
      message === "Unauthorized"
        ? 401
        : message === "Forbidden"
          ? 403
          : conflictErrors.some((code) => message.includes(code))
            ? 409
            : validationErrors.some((code) => message.includes(code))
              ? 400
              : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
