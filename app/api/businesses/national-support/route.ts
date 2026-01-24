import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";

/**
 * 건강디딤돌 신청결과 등록 API
 * POST /api/businesses/national-support
 */
export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");

    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { code, year, period, application_status, result, national_support_status } = body;

    // 필수 필드 검증
    if (!code || !year || !period) {
      return NextResponse.json(
        { error: "코드, 측정년도, 측정주기는 필수입니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 신청결과에 따라 국고지원 상태 자동 계산
    let calculatedStatus: "지원" | "비대상" | null = national_support_status;
    if (!calculatedStatus) {
      // '비대상'이 아니면서 '대상'을 포함하는 경우에만 지원으로 설정
      if (result && (result === "대상" || (result.includes("대상") && !result.includes("비대상")))) {
        calculatedStatus = "지원";
      } else if (result || application_status) {
        calculatedStatus = "비대상";
      }
    }

    // 중복 체크
    const { data: existing, error: checkError } = await supabase
      .from("national_support_application")
      .select("id")
      .eq("code", code)
      .eq("year", parseInt(year))
      .eq("period", period)
      .maybeSingle();

    if (checkError) {
      console.error("중복 체크 오류:", checkError);
      return NextResponse.json(
        { error: "중복 체크 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    if (existing) {
      return NextResponse.json(
        { error: "이미 같은 코드/년도/주기 조합의 신청결과가 존재합니다." },
        { status: 400 }
      );
    }

    // 등록
    const { data: created, error: createError } = await supabase
      .from("national_support_application")
      .insert({
        code,
        year: parseInt(year),
        period,
        application_status: application_status || null,
        result: result || null,
        national_support_status: calculatedStatus,
      })
      .select()
      .single();

    if (createError) {
      console.error("건강디딤돌 신청결과 등록 오류:", createError);
      return NextResponse.json(
        { error: "건강디딤돌 신청결과를 등록하는 중 오류가 발생했습니다.", details: createError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: created,
    });
  } catch (error: any) {
    console.error("건강디딤돌 신청결과 등록 API 오류:", error);
    return NextResponse.json(
      { error: error.message || "건강디딤돌 신청결과를 등록하는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 건강디딤돌 신청결과 조회 API
 * GET /api/businesses/national-support
 */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");
  } catch (permissionError: any) {
    console.error("권한 체크 오류:", permissionError);
    return NextResponse.json(
      {
        error: permissionError.message || "권한이 없습니다.",
        details: permissionError?.message
      },
      { status: permissionError.message?.includes("로그인") ? 401 : 403 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const period = searchParams.get("period");
    const code = searchParams.get("code");
    const resultParam = searchParams.get("result");

    const supabase = await createClient();

    if (!supabase) {
      throw new Error("Supabase 클라이언트를 생성할 수 없습니다.");
    }

    // national_support_application 조회
    let query = supabase
      .from("national_support_application")
      .select("*")
      .order("code", { ascending: true });

    if (year) {
      query = query.eq("year", parseInt(year));
    }

    if (period) {
      query = query.ilike("period", `${period}%`);
    }

    if (code) {
      query = query.ilike("code", `%${code}%`);
    }

    if (resultParam) {
      query = query.ilike("result", `%${resultParam}%`);
    }

    const { data: entries, error } = await query;

    if (error) {
      console.error("건강디딤돌 신청결과 조회 오류:", error);
      return NextResponse.json(
        { error: "건강디딤돌 신청결과 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // code 목록 추출
    const codes = (entries || []).map((entry: any) => entry.code).filter(Boolean);

    // 사업장 정보 조회 (우선순위: 1. business_info, 2. measurement_business)
    let businessMap = new Map<string, { name: string; address: string }>();
    if (codes.length > 0) {
      try {
        // 1차: business_info에서 조회
        const { data: infoBusinesses, error: infoError } = await supabase
          .from("business_info")
          .select("code, business_name, address1, address2")
          .in("code", codes);

        if (infoError) {
          console.error("사업장정보 조회 오류:", infoError);
        } else if (infoBusinesses) {
          infoBusinesses.forEach((info: any) => {
            if (info.code) {
              const fullAddress = [info.address1, info.address2].filter(Boolean).join(" ");
              businessMap.set(info.code, {
                name: info.business_name,
                address: fullAddress
              });
            }
          });
        }

        // 2차: business_info에 없는 사업장 measurement_business에서 조회
        const missingCodes = codes.filter((code: string) => !businessMap.has(code));

        if (missingCodes.length > 0) {
          try {
            const { data: businesses, error: businessError } = await supabase
              .from("measurement_business")
              .select("code, business_name, address")
              .in("code", missingCodes);

            if (businessError) {
              console.error("측정사업장 추가 조회 오류:", businessError);
            } else if (businesses) {
              businesses.forEach((business: any) => {
                if (business.code) {
                  businessMap.set(business.code, {
                    name: business.business_name,
                    address: business.address
                  });
                }
              });
            }
          } catch (mbErr) {
            console.error("측정사업장 추가 조회 중 예외:", mbErr);
          }
        }

      } catch (err) {
        console.error("사업장명 조회 중 예외 발생:", err);
      }
    }

    // 사업장명, 주소 포함하여 반환
    const formattedEntries = (entries || []).map((entry: any) => {
      const businessInfo = businessMap.get(entry.code) || { name: null, address: null };
      return {
        ...entry,
        business_name: businessInfo.name,
        address: businessInfo.address,
      };
    });

    return NextResponse.json({
      entries: formattedEntries,
    });
  } catch (error) {
    console.error("건강디딤돌 신청결과 조회 API 오류:", error);

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
        error: "건강디딤돌 신청결과 조회 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
