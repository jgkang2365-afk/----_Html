import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * 사업장정보 검색 API
 * GET /api/business-info/search?code=XXX&businessName=XXX&address=XXX
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("survey:read");

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code")?.trim() || null;
    const businessName = searchParams.get("businessName")?.trim() || null;
    const designatedOffice = searchParams.get("designatedOffice")?.trim() || null;
    const address = searchParams.get("address")?.trim() || null;

    const supabase = await createClient();

    // business_info에서 기본 검색
    let query = supabase
      .from("business_info")
      .select("code, business_name, business_number, address1, address2")
      .order("business_name", { ascending: true });

    // 검색 조건 적용
    if (code) {
      query = query.ilike("code", `%${code}%`);
    }

    if (businessName) {
      query = query.ilike("business_name", `%${businessName}%`);
    }

    if (address) {
      query = query.or(`address1.ilike.%${address}%,address2.ilike.%${address}%`);
    }

    const { data: businessInfoList, error: infoError } = await query;

    if (infoError) {
      console.error("사업장정보 검색 오류:", infoError);
      return NextResponse.json(
        { error: "사업장정보 검색 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    if (!businessInfoList || businessInfoList.length === 0) {
      return NextResponse.json({ businesses: [] });
    }

    // measurement_business에서 지정한계_관할지청(office_jurisdiction) 정보 가져오기
    const codes = businessInfoList.map((b: any) => b.code);
    const { data: measurementBusinessList, error: mbError } = await supabase
      .from("measurement_business")
      .select("code, office_jurisdiction")
      .in("code", codes)
      .order("year", { ascending: false })
      .order("period", { ascending: false });

    // 지정한계_관할지청으로 필터링 (필요한 경우)
    let filteredCodes = codes;
    if (designatedOffice && measurementBusinessList) {
      const filteredByOffice = measurementBusinessList
        .filter((mb: any) => mb.office_jurisdiction && mb.office_jurisdiction.includes(designatedOffice))
        .map((mb: any) => mb.code);
      filteredCodes = filteredCodes.filter((code: string) => filteredByOffice.includes(code));
    }

    // 코드별로 최신 measurement_business 정보 매핑
    const officeJurisdictionMap = new Map<string, string>();
    if (measurementBusinessList) {
      measurementBusinessList.forEach((mb: any) => {
        if (!officeJurisdictionMap.has(mb.code)) {
          officeJurisdictionMap.set(mb.code, mb.office_jurisdiction || "");
        }
      });
    }

    // 지정한계_관할지청 필터링 적용
    const filteredBusinessInfo = businessInfoList.filter((b: any) => 
      !designatedOffice || filteredCodes.includes(b.code)
    );

    // 주소 병합 및 결과 구성
    const businesses = filteredBusinessInfo.map((business: any) => ({
      code: business.code,
      business_number: business.business_number || "",
      business_name: business.business_name,
      address: [business.address1, business.address2].filter(Boolean).join(" ").trim() || "",
      office_jurisdiction: officeJurisdictionMap.get(business.code) || "",
    }));

    return NextResponse.json({ businesses });
  } catch (error) {
    console.error("사업장정보 검색 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json(
          { error: "로그인이 필요합니다." },
          { status: 401 }
        );
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { error: "권한이 없습니다." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      {
        error: "사업장정보 검색 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
