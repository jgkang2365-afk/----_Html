import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import * as XLSX from "xlsx";

/**
 * 건강디딤돌 신청결과 엑셀 다운로드 API
 * GET /api/export/national-support
 */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const period = searchParams.get("period");
    const code = searchParams.get("code");

    const supabase = await createClient();

    // 건강디딤돌 신청결과 목록 조회
    let query = supabase
      .from("national_support_application")
      .select("*")
      .order("year", { ascending: false })
      .order("period", { ascending: false })
      .order("code", { ascending: true });

    if (year) {
      query = query.eq("year", parseInt(year));
    }

    if (period) {
      query = query.eq("period", period);
    }

    if (code) {
      query = query.ilike("code", `%${code}%`);
    }

    const resultParam = searchParams.get("result");
    if (resultParam) {
      query = query.ilike("result", `%${resultParam}%`);
    }

    const { data: entries, error } = await query;

    if (error) {
      console.error("건강디딤돌 신청결과 목록 조회 오류:", error);
      return NextResponse.json(
        { error: "건강디딤돌 신청결과 목록 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // code 목록 추출 및 사업장 정보 조회
    const codes = (entries || []).map((entry: any) => entry.code).filter(Boolean);
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
                name: info.business_name || "",
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
                    name: business.business_name || "",
                    address: business.address || ""
                  });
                }
              });
            }
          } catch (mbErr) {
            console.error("측정사업장 추가 조회 중 예외:", mbErr);
          }
        }
      } catch (err) {
        console.error("사업장 정보 조회 오류:", err);
      }
    }

    // 엑셀 데이터 준비
    const excelData = (entries || []).map((entry) => {
      const businessInfo = businessMap.get(entry.code) || { name: "", address: "" };
      return {
        코드: entry.code || "",
        사업장명: businessInfo.name,
        주소: businessInfo.address,
        측정년도: entry.year || "",
        측정주기: entry.period || "",
        신청여부: entry.application_status || "",
        신청결과: entry.result || "",
        국고지원상태: entry.national_support_status || "",
        등록일시: entry.created_at
          ? new Date(entry.created_at).toLocaleString("ko-KR")
          : "",
        수정일시: entry.updated_at
          ? new Date(entry.updated_at).toLocaleString("ko-KR")
          : "",
      };
    });

    // 엑셀 워크북 생성
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "건강디딤돌신청결과");

    // 엑셀 파일 생성
    const excelBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    // 파일명 생성
    const fileName = `건강디딤돌_신청결과_${year || "전체"}_${period || "전체"}_${new Date().toISOString().split("T")[0]}.xlsx`;

    return new NextResponse(excelBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    console.error("건강디딤돌 신청결과 엑셀 다운로드 오류:", error);
    return NextResponse.json(
      {
        error: "엑셀 다운로드 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
