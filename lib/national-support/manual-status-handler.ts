import { NextRequest, NextResponse } from "next/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { getUser } from "@/lib/auth/get-user";
import { isAdHocMeasurement } from "@/lib/national-support/eligibility";

type Dependencies = {
  getUser: typeof getUser;
  createAdminClient: typeof createAdminClient;
};

/** 로그인 사용자만 내부 상태를 수동 확정한다. 외부 신청은 생성하지 않는다. */
export async function handleManualNationalSupportStatus(
  request: NextRequest,
  { getUser, createAdminClient }: Dependencies,
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { id, code, year, period, national_support_status } = await request.json();
  if (national_support_status !== "대상" && national_support_status !== "비대상") {
    return NextResponse.json({ error: "국고지원 상태는 대상 또는 비대상만 가능합니다." }, { status: 400 });
  }
  // RPC 직접 실행 권한은 public/authenticated에서 revoke되어 있다.
  const supabase = createAdminClient();
  let targetId = id;
  let targetPeriod: string | null = null;
  if (targetId) {
    const { data: target, error } = await supabase.from("measurement_target_business")
      .select("id, period").eq("id", targetId).maybeSingle();
    if (error || !target) return NextResponse.json({ error: error?.message || "대상 사업장을 찾을 수 없습니다." }, { status: 404 });
    targetId = target.id;
    targetPeriod = target.period;
  } else if (code && year && period) {
    const { data: target, error } = await supabase.from("measurement_target_business")
      .select("id, period").eq("code", code).eq("year", year).eq("period", period).maybeSingle();
    if (error || !target) return NextResponse.json({ error: error?.message || "대상 사업장을 찾을 수 없습니다." }, { status: 404 });
    targetId = target.id;
    targetPeriod = target.period;
  }
  if (!targetId) return NextResponse.json({ error: "대상 사업장 식별자가 필요합니다." }, { status: 400 });
  if (isAdHocMeasurement(targetPeriod) && national_support_status === "대상") {
    return NextResponse.json({ error: "수시 주기는 건강디딤돌 비대상으로 처리됩니다." }, { status: 400 });
  }
  const { data, error } = await supabase.rpc("set_manual_national_support_status", {
    p_target_id: targetId,
    p_status: national_support_status,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data });
}
