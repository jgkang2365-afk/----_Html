import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");
    const params = new URL(request.url).searchParams;
    const id = params.get("id")?.trim();
    const code = params.get("code")?.trim();
    const yearText = params.get("year")?.trim();
    const year = Number(yearText);
    const period = params.get("period")?.trim();
    if (!id || !code || !yearText || !Number.isInteger(year) || !period) {
      return NextResponse.json({ error: "사업장 식별자가 필요합니다." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: target, error: targetError } = await supabase
      .from("measurement_target_business")
      .select("id,code,year,period,business_type")
      .eq("id", id)
      .eq("code", code)
      .eq("year", year)
      .eq("period", period)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return NextResponse.json({ error: "일치하는 측정대상이 없습니다." }, { status: 404 });
    const match = { id: target.id, code: target.code, year: target.year, period: target.period };
    if (target.business_type !== "first_measurement" && target.business_type !== "external_new") {
      return NextResponse.json({ match, businessInfo: null });
    }

    const { data: businessInfo, error: infoError } = await supabase
      .from("business_info")
      .select("code,notes,representative_name,national_support_representative_name")
      .eq("code", code)
      .maybeSingle();
    if (infoError) throw infoError;
    return NextResponse.json({ match, businessInfo: businessInfo || null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Unauthorized")) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    if (message.includes("Forbidden")) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    console.error("측정대상 편집 보완자료 조회 오류:", error);
    return NextResponse.json({ error: "사업장 보완자료 조회 중 오류가 발생했습니다." }, { status: 500 });
  }
}
