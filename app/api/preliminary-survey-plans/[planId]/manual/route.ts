import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  applyManualPlanSelection,
  PlanView,
} from "@/lib/preliminary-survey/service";
import { loadPreliminarySurveyCalendarSignals } from "@/lib/preliminary-survey/google-calendar-signals";

export async function POST(
  request: NextRequest,
  { params }: { params: { planId: string } },
) {
  try {
    await checkPermission("survey:write");
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const recommendedDate = String(body.recommendedDate || "");
    const responsibleUserId = Number(body.responsibleUserId);
    const experiencedUserId = body.experiencedUserId
      ? Number(body.experiencedUserId)
      : null;
    const expectedRowVersion = Number(body.expectedRowVersion);
    if (
      !recommendedDate ||
      !Number.isInteger(responsibleUserId) ||
      !Number.isInteger(expectedRowVersion)
    ) {
      return NextResponse.json({ error: "MANUAL_SELECTION_REQUIRED" }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: plan, error } = await supabase
      .from("preliminary_survey_plans")
      .select("*")
      .eq("id", params.planId)
      .maybeSingle();
    if (error || !plan) {
      return NextResponse.json({ error: "PLAN_NOT_FOUND" }, { status: 404 });
    }
    if (Number(plan.row_version) !== expectedRowVersion) {
      return NextResponse.json({ error: "PLAN_VERSION_CONFLICT" }, { status: 409 });
    }

    const calendar = await loadPreliminarySurveyCalendarSignals(
      supabase,
      Number(plan.measurement_target_business_id),
    );

    const result = await applyManualPlanSelection(supabase, plan as PlanView, {
      recommendedDate,
      responsibleUserId,
      experiencedUserId,
      expectedRowVersion,
      calendarSignals: calendar.signals,
      calendarStatus: calendar.status,
      calendarCheckedAt: calendar.checkedAt,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PLAN_MANUAL_UPDATE_FAILED";
    const conflictCodes = [
      "PLAN_VERSION_CONFLICT",
      "CONFIRMED_PLAN_REQUIRES_CANCEL",
      "USER_SCHEDULE_BLOCK_CONFLICT",
      "DIFFERENT_REGION_MEASUREMENT_CONFLICT",
      "GOOGLE_CALENDAR_PRELIMINARY_CONFLICT",
    ];
    const validationCodes = [
      "INVALID_RECOMMENDED_DATE",
      "NON_WORKING_DAY",
      "INVALID_RESPONSIBLE_USER_ID",
      "RECOMMENDED_DATE_OUT_OF_RANGE",
      "RESPONSIBLE_USER_UNAVAILABLE",
      "MANUAL_NOVICE_REQUIRES_EXPERIENCED_COMPANION",
      "EXPERIENCED_COMPANION_UNAVAILABLE",
      "RECOMMENDATION_OPTION_NOT_ALLOWED",
      "JULY_2026_PRELIMINARY_SURVEYOR_MUST_MATCH_MEASURER",
      "ADDRESS_REGION_UNAVAILABLE",
    ];
    const status = message === "Unauthorized"
      ? 401
      : message === "Forbidden"
        ? 403
        : conflictCodes.some((code) => message.includes(code))
          ? 409
          : validationCodes.some((code) => message.includes(code))
            ? 400
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
