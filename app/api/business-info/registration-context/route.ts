import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const EXACT_MEASUREMENT_BUSINESS_FIELDS = [
  "representative_name",
  "address",
  "business_category",
  "industrial_accident_number",
  "commencement_number",
  "manager_name",
  "manager_mobile",
  "manager_phone",
  "phone",
  "fax",
  "total_employees",
  "updated_at",
].join(",");

export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code")?.trim() || "";
    const period = searchParams.get("period")?.trim() || "";
    const yearText = searchParams.get("year")?.trim() || "";
    const year = Number(yearText);

    if (!code || !period || !Number.isInteger(year)) {
      return NextResponse.json(
        { error: "사업장 코드, 측정연도, 측정주기가 필요합니다." },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("measurement_business")
      .select(EXACT_MEASUREMENT_BUSINESS_FIELDS)
      .eq("code", code)
      .eq("year", year)
      .eq("period", period)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("신규 등록 measurement_business 정확 일치 조회 오류:", error);
      return NextResponse.json(
        { error: "측정사업장 보완자료 조회 중 오류가 발생했습니다." },
        { status: 500 },
      );
    }

    const measurementBusiness = data?.[0] || null;
    return NextResponse.json({
      measurementBusiness,
      hasSupplementaryData: Boolean(measurementBusiness),
      match: { code, year, period },
    });
  } catch (error) {
    console.error("신규 등록 보완자료 API 오류:", error);
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Unauthorized")) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    if (message.includes("Forbidden")) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }
    return NextResponse.json(
      { error: "측정사업장 보완자료 조회 중 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
