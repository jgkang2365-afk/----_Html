import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { recommendAndPersistPreliminarySurvey } from "@/lib/preliminary-survey/service";
import { loadPreliminarySurveyCalendarSignals } from "@/lib/preliminary-survey/google-calendar-signals";

export async function POST(request: NextRequest) {
  try {
    await checkPermission("survey:write");
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = await request.json();
    const targetId = Number(body.measurementTargetBusinessId);
    if (!Number.isInteger(targetId)) {
      return NextResponse.json({ error: "INVALID_TARGET_ID" }, { status: 400 });
    }

    const supabase = await createClient();
    const calendar = await loadPreliminarySurveyCalendarSignals(supabase, targetId);
    const recommendation = await recommendAndPersistPreliminarySurvey(supabase, {
      targetId,
      actorUserId: session.userId,
      manual: true,
      replaceConfirmed: body.replaceConfirmed === true,
      calendarSignals: calendar.signals,
      calendarStatus: calendar.status,
      calendarCheckedAt: calendar.checkedAt,
    });
    return NextResponse.json({
      success: true,
      plan: recommendation.plan,
      preliminarySurveyRecommendation: recommendation.result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "RECOMMENDATION_ERROR";
    const conflictCodes = [
      "PLAN_SOURCE_CHANGED",
      "CONFIRMED_PLAN_REQUIRES_CANCEL",
      "PLAN_VERSION_CONFLICT",
    ];
    const status =
      message === "Unauthorized"
        ? 401
        : message === "Forbidden"
          ? 403
          : conflictCodes.some((code) => message.includes(code))
            ? 409
            : message.includes("TARGET_NOT_SUPPORTED_PRELIMINARY_SURVEY")
              ? 400
              : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
