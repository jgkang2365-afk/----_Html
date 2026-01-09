import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * 예비조사 API
 * GET: 예비조사 목록 조회
 * POST: 예비조사 등록
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("survey:read");

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code")?.trim() || null;
    const businessNumber = searchParams.get("businessNumber")?.trim() || null;
    const businessName = searchParams.get("businessName")?.trim() || null;
    const officeJurisdiction = searchParams.get("officeJurisdiction")?.trim() || null;
    const address = searchParams.get("address")?.trim() || null;

    const supabase = await createClient();

    // 1. 사업장정보 테이블에서 검색 조건에 맞는 전체 데이터 조회
    let businessInfoQuery = supabase
      .from("business_info")
      .select("code, business_name, business_number, address1, address2, office_jurisdiction")
      .not("business_name", "ilike", "%번외%"); // "*번외*" 포함 사업장 제외

    if (code) {
      businessInfoQuery = businessInfoQuery.ilike("code", `%${code}%`);
    }

    if (businessNumber) {
      businessInfoQuery = businessInfoQuery.ilike("business_number", `%${businessNumber}%`);
    }

    if (businessName) {
      businessInfoQuery = businessInfoQuery.ilike("business_name", `%${businessName}%`);
    }

    if (address) {
      businessInfoQuery = businessInfoQuery.or(`address1.ilike.%${address}%,address2.ilike.%${address}%`);
    }

    // 소재지 관할청 필터링 (business_info 테이블의 office_jurisdiction 필드 사용)
    if (officeJurisdiction) {
      // 부분 일치 검색 (대소문자 구분 없음)
      const searchTerm = officeJurisdiction.trim();
      
      // Supabase의 ilike는 부분 일치를 지원하므로 직접 사용
      // "대전지방고용노동청 보령지청" 전체 문자열로 검색
      businessInfoQuery = businessInfoQuery.ilike("office_jurisdiction", `%${searchTerm}%`);
      
      // 디버깅: 검색 조건 로그
      console.log("소재지 관할청 검색 조건:", searchTerm);
    }

    const { data: businessInfoList, error: businessInfoError } = await businessInfoQuery;
    
    // 디버깅: 검색 결과 로그
    if (officeJurisdiction) {
      console.log(`소재지 관할청 "${officeJurisdiction}" 검색 결과:`, {
        "매칭된 건수": businessInfoList?.length || 0,
        "샘플 코드": businessInfoList?.slice(0, 5).map((b: any) => ({
          code: b.code,
          office_jurisdiction: b.office_jurisdiction,
        })),
      });
      
      // 실제 데이터베이스에 어떤 관할청 값들이 있는지 샘플 확인
      if (!businessInfoList || businessInfoList.length === 0) {
        console.warn("검색 결과가 없습니다. 데이터베이스의 관할청 샘플 확인 중...");
        const { data: sampleData } = await supabase
          .from("business_info")
          .select("code, office_jurisdiction")
          .not("office_jurisdiction", "is", null)
          .limit(50);
        const uniqueOffices = [...new Set(sampleData?.map((b: any) => b.office_jurisdiction).filter(Boolean) || [])];
        console.log("데이터베이스의 관할청 샘플 (중복 제거, 상위 20개):", uniqueOffices.slice(0, 20));
        
        // 검색어와 유사한 값 찾기
        const similarOffices = uniqueOffices.filter((office: string) => 
          office.includes(officeJurisdiction) || officeJurisdiction.includes(office)
        );
        if (similarOffices.length > 0) {
          console.log("검색어와 유사한 관할청:", similarOffices);
        }
      }
    }

    if (businessInfoError) {
      console.error("사업장정보 검색 오류:", businessInfoError);
      // office_jurisdiction 컬럼이 없는 경우 (마이그레이션 미실행) fallback 처리
      if (businessInfoError.message?.includes("office_jurisdiction") || businessInfoError.code === "PGRST204") {
        console.warn("office_jurisdiction 컬럼이 없습니다. measurement_business에서 검색합니다.");
        
        // 기본 쿼리 재실행 (office_jurisdiction 제외)
        let fallbackQuery = supabase
          .from("business_info")
          .select("code")
          .not("business_name", "ilike", "%번외%"); // "*번외*" 포함 사업장 제외

        if (code) {
          fallbackQuery = fallbackQuery.ilike("code", `%${code}%`);
        }
        if (businessNumber) {
          fallbackQuery = fallbackQuery.ilike("business_number", `%${businessNumber}%`);
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
            { error: "사업장정보 검색 중 오류가 발생했습니다.", details: fallbackError.message },
            { status: 500 }
          );
        }

        // measurement_business에서 관할청 필터링
        const codes = fallbackList?.map((b: any) => b.code) || [];
        let filteredCodes = codes;
        
        if (officeJurisdiction && codes.length > 0) {
          const { data: measurementBusinessList, error: mbError } = await supabase
            .from("measurement_business")
            .select("code, office_jurisdiction")
            .in("code", codes)
            .order("year", { ascending: false })
            .order("period", { ascending: false });

          if (!mbError && measurementBusinessList) {
            const codesByOffice = measurementBusinessList
              .filter((mb: any) => mb.office_jurisdiction && mb.office_jurisdiction === officeJurisdiction)
              .map((mb: any) => mb.code);
            filteredCodes = [...new Set(codesByOffice)];
          }
        }

        // 예비조사 테이블에서 검색
        let surveyQuery = supabase
          .from("preliminary_survey")
          .select("*")
          .order("measurement_date", { ascending: false })
          .order("created_at", { ascending: false });

        if (filteredCodes.length > 0) {
          surveyQuery = surveyQuery.in("code", filteredCodes);
        } else if (code || businessNumber || businessName || address || officeJurisdiction) {
          return NextResponse.json({ surveys: [] });
        }

        const { data: surveys, error } = await surveyQuery;
        if (error) {
          console.error("예비조사 조회 오류:", error);
          return NextResponse.json(
            { error: "예비조사 조회 중 오류가 발생했습니다.", details: error.message },
            { status: 500 }
          );
        }

        return NextResponse.json({ surveys: surveys || [] });
      }
      
      return NextResponse.json(
        { error: "사업장정보 검색 중 오류가 발생했습니다.", details: businessInfoError.message },
        { status: 500 }
      );
    }

    // 검색 조건에 맞는 코드 목록
    const codes = businessInfoList?.map((b: any) => b.code) || [];
    
    // 검색 조건이 있지만 매칭되는 코드가 없는 경우 빈 배열 반환
    if (codes.length === 0 && (code || businessNumber || businessName || address || officeJurisdiction)) {
      return NextResponse.json({ 
        businesses: [],
        surveys: [] 
      });
    }

    // 2. 예비조사 테이블에서 해당 코드들로 검색 (있는 경우만)
    let surveys: any[] = [];
    if (codes.length > 0) {
      const surveyQuery = supabase
        .from("preliminary_survey")
        .select("*")
        .in("code", codes)
        .order("measurement_date", { ascending: false })
        .order("created_at", { ascending: false });

      const { data: surveyData, error: surveyError } = await surveyQuery;
      
      if (surveyError) {
        console.error("예비조사 조회 오류:", surveyError);
      } else {
        surveys = surveyData || [];
      }
    }

    // 3. 사업장정보 데이터를 반환 형식으로 변환
    const businesses = businessInfoList?.map((business: any) => ({
      code: business.code,
      business_name: business.business_name,
      business_number: business.business_number || "",
      address: [business.address1, business.address2].filter(Boolean).join(" ").trim() || "",
      office_jurisdiction: business.office_jurisdiction || "",
    })) || [];

    return NextResponse.json({ 
      businesses: businesses,
      surveys: surveys 
    });
  } catch (error) {
    console.error("예비조사 API 오류:", error);

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
        error: "예비조사 조회 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("survey:write");

    const body = await request.json();
    const {
      measurement_date,
      end_date,
      measurement_weekdays,
      code,
      business_name,
      measurer,
      survey_code,
      address,
      preliminary_surveyor,
      actual_measurer,
      report_writer,
    } = body;

    // 필수 필드 검증
    if (!measurement_date || !business_name) {
      return NextResponse.json(
        { error: "측정일과 사업장명은 필수 항목입니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 예비조사 등록
    const { data: survey, error } = await supabase
      .from("preliminary_survey")
      .insert({
        measurement_date,
        end_date: end_date || measurement_date,
        measurement_weekdays: measurement_weekdays || null,
        code: code || null,
        business_name,
        measurer: measurer || null,
        survey_code: survey_code || null,
        address: address || null,
        preliminary_surveyor: preliminary_surveyor || null,
        actual_measurer: actual_measurer || null,
        report_writer: report_writer || null,
      })
      .select()
      .single();

    if (error) {
      console.error("예비조사 등록 오류:", error);
      return NextResponse.json(
        { error: "예비조사 등록 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ survey }, { status: 201 });
  } catch (error) {
    console.error("예비조사 등록 API 오류:", error);

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
        error: "예비조사 등록 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
