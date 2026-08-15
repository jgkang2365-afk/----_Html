import { NextRequest, NextResponse } from "next/server";

import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

const POLICY_KEY = "process_changed_preliminary_survey";
const PERIODS = new Set(["상반기", "하반기"]);

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET() {
  try {
    await checkPermission("system:settings");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("preliminary_survey_policy_settings")
      .select("policy_key, enabled, effective_start_year, effective_start_period, effective_start_measurement_date, updated_by, created_at, updated_at")
      .eq("policy_key", POLICY_KEY)
      .single();
    if (error) throw error;
    return NextResponse.json({ policy: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "정책 조회 실패";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await checkPermission("system:settings");
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled 값은 boolean이어야 합니다." }, { status: 400 });
    }

    const year = body.effective_start_year ?? null;
    const period = body.effective_start_period ?? null;
    const date = body.effective_start_measurement_date ?? null;
    const validDate = date === null || isValidIsoDate(date);
    if (
      (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100)) ||
      (period !== null && !PERIODS.has(period)) ||
      !validDate ||
      (body.enabled && (year === null || period === null || date === null))
    ) {
      return NextResponse.json({ error: "정책 적용 시작값을 확인해 주세요." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("preliminary_survey_policy_settings")
      .update({
        enabled: body.enabled,
        effective_start_year: year,
        effective_start_period: period,
        effective_start_measurement_date: date,
        updated_by: session.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("policy_key", POLICY_KEY)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ policy: data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "정책 변경 실패";
    const status = message === "Unauthorized" ? 401 : message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
