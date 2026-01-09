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
    const officeJurisdiction = searchParams.get("officeJurisdiction")?.trim() || null; // 소재지 관할청
    const address = searchParams.get("address")?.trim() || null;

    const supabase = await createClient();

    // business_info에서 기본 검색 (office_jurisdiction 포함)
    let query = supabase
      .from("business_info")
      .select("code, business_name, business_number, address1, address2, office_jurisdiction")
      .not("business_name", "ilike", "%번외%") // "*번외*" 포함 사업장 제외
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

    // 소재지 관할청 필터링 (business_info 테이블의 office_jurisdiction 필드 사용)
    if (officeJurisdiction) {
      query = query.ilike("office_jurisdiction", `%${officeJurisdiction}%`);
    }

    const { data: businessInfoList, error: infoError } = await query;

    if (infoError) {
      console.error("사업장정보 검색 오류:", infoError);
      // office_jurisdiction 컬럼이 없는 경우 fallback 처리
      if (infoError.message?.includes("office_jurisdiction") || infoError.code === "PGRST204") {
        console.warn("office_jurisdiction 컬럼이 없습니다. 기본 필드만 조회합니다.");
        
        // 기본 쿼리 재실행 (office_jurisdiction 제외)
        let fallbackQuery = supabase
          .from("business_info")
          .select("code, business_name, business_number, address1, address2")
          .not("business_name", "ilike", "%번외%") // "*번외*" 포함 사업장 제외
          .order("business_name", { ascending: true });

        if (code) {
          fallbackQuery = fallbackQuery.ilike("code", `%${code}%`);
        }
        if (businessName) {
          fallbackQuery = fallbackQuery.ilike("business_name", `%${businessName}%`);
        }
        if (address) {
          fallbackQuery = fallbackQuery.or(`address1.ilike.%${address}%,address2.ilike.%${address}%`);
        }

        const { data: fallbackList, error: fallbackError } = await fallbackQuery;
        if (fallbackError) {
          return NextResponse.json(
            { error: "사업장정보 검색 중 오류가 발생했습니다." },
            { status: 500 }
          );
        }

        // measurement_business에서 관할청 정보 가져오기
        const codes = fallbackList?.map((b: any) => b.code) || [];
        const { data: measurementBusinessList } = await supabase
          .from("measurement_business")
          .select("code, office_jurisdiction")
          .in("code", codes)
          .order("year", { ascending: false })
          .order("period", { ascending: false });

        const officeJurisdictionMap = new Map<string, string>();
        if (measurementBusinessList) {
          measurementBusinessList.forEach((mb: any) => {
            if (!officeJurisdictionMap.has(mb.code)) {
              officeJurisdictionMap.set(mb.code, mb.office_jurisdiction || "");
            }
          });
        }

        // 소재지 관할청 필터링 (officeJurisdiction 파라미터가 있는 경우)
        let filteredList = fallbackList || [];
        if (officeJurisdiction && measurementBusinessList) {
          const filteredByOffice = measurementBusinessList
            .filter((mb: any) => mb.office_jurisdiction && mb.office_jurisdiction.includes(officeJurisdiction))
            .map((mb: any) => mb.code);
          filteredList = filteredList.filter((b: any) => filteredByOffice.includes(b.code));
        }

        const businesses = filteredList.map((business: any) => ({
          code: business.code,
          business_number: business.business_number || "",
          business_name: business.business_name,
          address: [business.address1, business.address2].filter(Boolean).join(" ").trim() || "",
          office_jurisdiction: officeJurisdictionMap.get(business.code) || "",
        }));

        return NextResponse.json({ businesses });
      }
      
      return NextResponse.json(
        { error: "사업장정보 검색 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    if (!businessInfoList || businessInfoList.length === 0) {
      return NextResponse.json({ businesses: [] });
    }

    // measurement_business에서 지정한계_관할지청(office_jurisdiction) 정보 가져오기 (참고용)
    const codes = businessInfoList.map((b: any) => b.code);
    const { data: measurementBusinessList } = await supabase
      .from("measurement_business")
      .select("code, office_jurisdiction")
      .in("code", codes)
      .order("year", { ascending: false })
      .order("period", { ascending: false });

    // 지정한계_관할지청으로 필터링 (필요한 경우)
    let filteredBusinessInfo = businessInfoList;
    if (designatedOffice && measurementBusinessList) {
      const filteredByOffice = measurementBusinessList
        .filter((mb: any) => mb.office_jurisdiction && mb.office_jurisdiction.includes(designatedOffice))
        .map((mb: any) => mb.code);
      filteredBusinessInfo = filteredBusinessInfo.filter((b: any) => filteredByOffice.includes(b.code));
    }

    // 코드별로 최신 measurement_business 정보 매핑 (참고용)
    const officeJurisdictionMap = new Map<string, string>();
    if (measurementBusinessList) {
      measurementBusinessList.forEach((mb: any) => {
        if (!officeJurisdictionMap.has(mb.code)) {
          officeJurisdictionMap.set(mb.code, mb.office_jurisdiction || "");
        }
      });
    }

    // 주소 병합 및 결과 구성
    // business_info의 office_jurisdiction을 우선 사용, 없으면 measurement_business의 값 사용
    const businesses = filteredBusinessInfo.map((business: any) => ({
      code: business.code,
      business_number: business.business_number || "",
      business_name: business.business_name,
      address: [business.address1, business.address2].filter(Boolean).join(" ").trim() || "",
      office_jurisdiction: business.office_jurisdiction || officeJurisdictionMap.get(business.code) || "",
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
