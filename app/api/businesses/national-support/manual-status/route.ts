import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/get-user";

/** 관리자 내부 상태 확정 전용. 신청 레코드·자동화 큐·외부 신청을 생성하지 않는다. */
export async function PATCH(request: NextRequest) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (user.role !== "관리자") return NextResponse.json({ error: "관리자만 국고지원을 수동 확정할 수 있습니다." }, { status: 403 });

  const { id, code, year, period, national_support_status } = await request.json();
  if (national_support_status !== "대상" && national_support_status !== "비대상") {
    return NextResponse.json({ error: "국고지원 상태는 대상 또는 비대상만 가능합니다." }, { status: 400 });
  }
  // RPC 자체는 public/authenticated에서 revoke되어 있으므로, 이미 확인한
  // 서버 관리자 권한 경계 뒤에만 service-role client로 호출한다.
  const supabase = createAdminClient();
  let targetId = id;
  if (!targetId && code && year && period) {
    const { data: target, error } = await supabase.from("measurement_target_business")
      .select("id").eq("code", code).eq("year", year).eq("period", period).maybeSingle();
    if (error || !target) return NextResponse.json({ error: error?.message || "대상 사업장을 찾을 수 없습니다." }, { status: 404 });
    targetId = target.id;
  }
  if (!targetId) return NextResponse.json({ error: "대상 사업장 식별자가 필요합니다." }, { status: 400 });
  const { data, error } = await supabase.rpc("set_manual_national_support_status", {
    p_target_id: targetId,
    p_status: national_support_status,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data });
}
