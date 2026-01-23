import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

export async function GET(request: Request) {
  try {
    // 권한 체크
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const year = searchParams.get("year");
    const period = searchParams.get("period");

    const supabase = await createClient();

    // 특정 코드로 조회하는 경우
    if (code) {
      // 1. business_info 조회 (기본 정보)
      const { data: businessInfo, error: infoError } = await supabase
        .from("business_info")
        .select("*")
        .eq("code", code)
        .maybeSingle();

      if (infoError && infoError.code !== "PGRST116") {
        console.error("사업장정보 조회 오류:", infoError);
      }

      // 2. measurement_business 조회
      // 요청한 연도/주기에 맞는 데이터 우선 조회
      let businessData = null;
      if (year && period) {
        const { data: specificBusinessData, error: specificError } = await supabase
          .from("measurement_business")
          .select("*")
          .eq("code", code)
          .eq("year", parseInt(year))
          .eq("period", period)
          .maybeSingle();

        if (!specificError && specificBusinessData) {
          businessData = specificBusinessData;
        }
      }

      // 없으면 최신 데이터 조회 (fallback)
      if (!businessData) {
        const { data: latestBusinessData, error: latestError } = await supabase
          .from("measurement_business")
          .select("*")
          .eq("code", code)
          .order("year", { ascending: false })
          .order("period", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!latestError && latestBusinessData) {
          businessData = latestBusinessData;
        }
      }

      // 3. measurement_journal 조회 (담당자 정보 우선순위: journal > business)
      // 가장 최신 journal 데이터에서 담당자 정보 가져오기
      let journalManagerInfo = null;
      const { data: latestJournal, error: journalError } = await supabase
        .from("measurement_journal")
        .select("manager_name, manager_mobile, manager_email, manager_position, phone, fax")
        .eq("code", code)
        .order("measurement_year", { ascending: false })
        .order("measurement_period", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!journalError && latestJournal) {
        journalManagerInfo = latestJournal;
      }

      // 데이터 병합 (우선순위: Journal > Business > Info)
      const business = {
        ...businessInfo,
        ...businessData,
        // 주소: Business > Info
        address: businessData?.address || businessInfo?.address1 || businessInfo?.address2 || "",
        // 담당자 정보: Journal > Business
        manager_name: journalManagerInfo?.manager_name || businessData?.manager_name || "",
        manager_position: journalManagerInfo?.manager_position || businessData?.manager_position || "",
        manager_mobile: journalManagerInfo?.manager_mobile || businessData?.manager_mobile || "",
        manager_email: journalManagerInfo?.manager_email || businessData?.manager_email || "",
        phone: journalManagerInfo?.phone || businessData?.phone || businessInfo?.phone || "",
        fax: journalManagerInfo?.fax || businessData?.fax || businessInfo?.fax || "",
      };

      return NextResponse.json({ business });
    }

    // 전체 목록 조회
    // business_info 테이블에서 데이터 조회 (사업장명 기준)
    const { data: businessInfoList, error: infoError } = await supabase
      .from("business_info")
      .select("code, business_name")
      .order("business_name", { ascending: true });

    if (infoError) {
      console.error("사업장정보 목록 조회 오류:", infoError);
    }

    // measurement_business 테이블에서도 조회
    // "*번외*" 포함 사업장 제외
    const { data: businessDataList, error: businessError } = await supabase
      .from("measurement_business")
      .select("code, business_name")
      .not("business_name", "ilike", "%번외%")
      .order("business_name", { ascending: true });

    if (businessError) {
      console.error("측정사업장 목록 조회 오류:", businessError);
      return NextResponse.json(
        { error: "측정사업장 목록을 불러오는 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // 중복 제거하여 병합
    const businessMap = new Map<string, { code: string; business_name: string }>();

    (businessInfoList || []).forEach((b: any) => {
      if (!businessMap.has(b.code)) {
        businessMap.set(b.code, { code: b.code, business_name: b.business_name });
      }
    });

    (businessDataList || []).forEach((b: any) => {
      if (!businessMap.has(b.code)) {
        businessMap.set(b.code, { code: b.code, business_name: b.business_name });
      }
    });

    const businesses = Array.from(businessMap.values());

    return NextResponse.json({ businesses });
  } catch (error) {
    console.error("측정사업장 목록 API 오류:", error);

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
        error: "측정사업장 목록을 불러오는 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

