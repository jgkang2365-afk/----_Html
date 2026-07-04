import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import { syncNationalSupportToBusiness } from "@/lib/sync/national-support";

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
    let calculatedStatus: "대상" | "비대상" | null = national_support_status;
    if (!calculatedStatus) {
      // '비대상'이 아니면서 '대상'을 포함하는 경우에만 대상으로 설정
      if (result && (result === "대상" || (result.includes("대상") && !result.includes("비대상")))) {
        calculatedStatus = "대상";
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

    // 측정 대상 사업장(measurement_business) 테이블에 국고지원 상태 동기화
    await syncNationalSupportToBusiness(
      supabase,
      code,
      parseInt(year),
      period,
      calculatedStatus
    );

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
    // key: "code-year-period" (exact) 또는 "code" (fallback)
    let targetBusinessMap = new Map<string, { representative_name: string | null; industrial_accident_number: string | null; commencement_number: string | null }>();

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

        // 3차: 대표자명, 산재관리번호, 사업개시번호 조회 (3단계 교차 Coalesce 결합)
        try {
          // 3-1. business_info 조회 (대표자명 마스터)
          const { data: bInfos } = await supabase
            .from("business_info")
            .select("code, representative_name")
            .in("code", codes);
          const bInfoMap = new Map<string, string>();
          if (bInfos) {
            bInfos.forEach((bi: any) => {
              if (bi.representative_name) bInfoMap.set(bi.code, bi.representative_name);
            });
          }

          // 3-2. measurement_business 조회 (대표자명, 산재번호, 개시번호 실적 마스터)
          const { data: mBusinesses } = await supabase
            .from("measurement_business")
            .select("code, representative_name, industrial_accident_number, commencement_number, year, period")
            .in("code", codes)
            .order("year", { ascending: false })
            .order("period", { ascending: false });

          const mbMap = new Map<string, { representative_name: string | null, industrial_accident_number: string | null, commencement_number: string | null }>();
          if (mBusinesses) {
            mBusinesses.forEach((mb: any) => {
              // 내림차순 정렬되어 있으므로 첫 레코드가 가장 최근 실적
              if (!mbMap.has(mb.code)) {
                mbMap.set(mb.code, {
                  representative_name: mb.representative_name || null,
                  industrial_accident_number: mb.industrial_accident_number || null,
                  commencement_number: mb.commencement_number || null
                });
              }
            });
          }

          // 3-3. measurement_target_business 조회 (당해년도 계획)
          const { data: targetBusinesses, error: targetError } = await supabase
            .from("measurement_target_business")
            .select("code, year, period, representative_name, industrial_accident_number, commencement_number, sync_status")
            .in("code", codes)
            .order("year", { ascending: false })
            .order("period", { ascending: false });

          if (!targetError && targetBusinesses) {
            targetBusinesses.forEach((tb: any) => {
              const exactKey = `${tb.code}-${tb.year}-${tb.period}`;
              
              // 3단계 결합 우선순위 정의 (1. 계획 테이블값 -> 2. 실적 마스터값 -> 3. 기본정보 마스터값)
              const mbFallback = mbMap.get(tb.code) || { representative_name: null, industrial_accident_number: null, commencement_number: null };
              const biRepName = bInfoMap.get(tb.code) || null;

              const payload = {
                representative_name: tb.representative_name || mbFallback.representative_name || biRepName || null,
                industrial_accident_number: tb.industrial_accident_number || mbFallback.industrial_accident_number || null,
                commencement_number: tb.commencement_number || mbFallback.commencement_number || null,
                sync_status: tb.sync_status || null
              };

              // exact key 저장
              targetBusinessMap.set(exactKey, payload);
              // code 전용 fallback 저장
              if (!targetBusinessMap.has(tb.code)) {
                targetBusinessMap.set(tb.code, payload);
              }
            });
          }

          // [안전 가드] measurement_target_business에 데이터가 아예 없더라도, 마스터 테이블(mb, bi)에 정보가 있으면 code 키로 맵을 채워줌
          codes.forEach((code: string) => {
            if (!targetBusinessMap.has(code)) {
              const mbFallback = mbMap.get(code) || { representative_name: null, industrial_accident_number: null, commencement_number: null };
              const biRepName = bInfoMap.get(code) || null;
              targetBusinessMap.set(code, {
                representative_name: mbFallback.representative_name || biRepName || null,
                industrial_accident_number: mbFallback.industrial_accident_number || null,
                commencement_number: mbFallback.commencement_number || null,
                sync_status: null
              });
            }
          });

        } catch (tErr) {
          console.error("대상 사업장 필수정보 추가 조회 중 예외:", tErr);
        }

      } catch (err) {
        console.error("사업장명 조회 중 예외 발생:", err);
      }
    }

    // 사업장명, 주소, 대표자, 산재번호, 사업개시번호 포함하여 반환
    const formattedEntries = (entries || []).map((entry: any) => {
      const businessInfo = businessMap.get(entry.code) || { name: null, address: null };
      const exactKey = `${entry.code}-${entry.year}-${entry.period}`;
      // year/period 정확 매칭 후 없으면 동일 code의 가장 최근 레코드로 fallback
      const targetInfo = targetBusinessMap.get(exactKey) || targetBusinessMap.get(entry.code) || { representative_name: null, industrial_accident_number: null, commencement_number: null, sync_status: null };

      return {
        ...entry,
        business_name: businessInfo.name,
        address: businessInfo.address,
        representative_name: targetInfo.representative_name,
        industrial_accident_number: targetInfo.industrial_accident_number,
        commencement_number: targetInfo.commencement_number,
        sync_status: targetInfo.sync_status
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
