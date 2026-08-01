import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: NextRequest,
  { params }: { params: { planId: string } },
) {
  try {
    await checkPermission("survey:write");
    const body = await request.json();
    const expectedRowVersion = Number(body.expectedRowVersion);
    if (!Number.isInteger(expectedRowVersion)) {
      return NextResponse.json({ error: "PLAN_VERSION_REQUIRED" }, { status: 400 });
    }
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("cancel_preliminary_survey_plan", {
      p_plan_id: params.planId,
      p_expected_row_version: expectedRowVersion,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ success: true, plan: (data || [])[0] || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PLAN_CANCEL_FAILED";
    const status =
      message === "Unauthorized"
        ? 401
        : message === "Forbidden"
          ? 403
          : message.includes("PLAN_VERSION_CONFLICT")
            ? 409
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
