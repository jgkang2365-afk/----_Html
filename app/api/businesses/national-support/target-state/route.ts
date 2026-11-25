import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { projectNationalSupportOrphanStatuses } from "@/lib/national-support/orphan-status";

export const dynamic = "force-dynamic";

/** 작업 terminal 뒤 동일 target의 상태만 읽는다. 다른 편집 필드는 반환하지 않는다. */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");
    const params = new URL(request.url).searchParams;
    const id = params.get("id")?.trim();
    const code = params.get("code")?.trim();
    const yearText = params.get("year")?.trim();
    const period = params.get("period")?.trim();
    const year = Number(yearText);
    if (!id || !code || !yearText || !Number.isInteger(year) || !period) {
      return NextResponse.json({ error: "사업장 식별자가 필요합니다." }, { status: 400 });
    }
    const { data, error } = await (await createClient()).from("measurement_target_business")
      .select("id,code,year,period,sync_status,national_support_status,sync_error_message")
      .eq("id", id).eq("code", code).eq("year", year).eq("period", period).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "일치하는 사업장이 없습니다." }, { status: 404 });
    const [state] = await projectNationalSupportOrphanStatuses(createAdminClient(), [data]);
    return NextResponse.json({ state }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Unauthorized")) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    if (message.includes("Forbidden")) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    console.error("건강디딤돌 상태 재조회 오류:", error);
    return NextResponse.json({ error: "사업장 상태를 가져오지 못했습니다." }, { status: 500 });
  }
}
