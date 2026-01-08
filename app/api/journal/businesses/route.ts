import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

export async function GET(request: Request) {
  try {
    // 권한 체크
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");

    const supabase = await createClient();

    // 특정 코드로 조회하는 경우
    if (code) {
      // business_info에서 먼저 조회
      const { data: businessInfo, error: infoError } = await supabase
        .from("business_info")
        .select("*")
        .eq("code", code)
        .maybeSingle();

      if (infoError && infoError.code !== "PGRST116") {
        console.error("사업장정보 조회 오류:", infoError);
      }

      // measurement_business에서도 조회
      const { data: businessData, error: businessError } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("code", code)
        .order("year", { ascending: false })
        .order("period", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (businessError && businessError.code !== "PGRST116") {
        console.error("측정사업장 조회 오류:", businessError);
      }

      // 두 데이터 병합
      const business = {
        ...businessInfo,
        ...businessData,
        address: businessData?.address || businessInfo?.address1 || businessInfo?.address2 || "",
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

