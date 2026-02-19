/**
 * H0432 데이터 확인 API
 * GET /api/debug/h0432
 * 데이터베이스에 H0432 데이터가 실제로 있는지 확인
 */

import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    // 권한 체크
    await checkPermission(["system:settings", "dashboard:read", "journal:read"]);

    const supabase = await createClient();

    // measurement_business에서 H0432 검색
    const { data: businessData, error: businessError } = await supabase
      .from("measurement_business")
      .select("*")
      .ilike("code", "%H0432%");

    // measurement_journal에서 H0432 검색
    const { data: journalData, error: journalError } = await supabase
      .from("measurement_journal")
      .select("*")
      .ilike("code", "%H0432%");

    // business_info에서 H0432 검색
    const { data: infoData, error: infoError } = await supabase
      .from("business_info")
      .select("*")
      .ilike("code", "%H0432%");

    return NextResponse.json({
      success: true,
      measurement_business: {
        count: businessData?.length || 0,
        data: businessData || [],
        error: businessError?.message || null,
      },
      measurement_journal: {
        count: journalData?.length || 0,
        data: journalData || [],
        error: journalError?.message || null,
      },
      business_info: {
        count: infoData?.length || 0,
        data: infoData || [],
        error: infoError?.message || null,
      },
      summary: {
        has_in_measurement_business: (businessData?.length || 0) > 0,
        has_in_measurement_journal: (journalData?.length || 0) > 0,
        has_in_business_info: (infoData?.length || 0) > 0,
      },
    });
  } catch (error) {
    console.error("H0432 디버깅 API 오류:", error);

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
        error: "오류 발생",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
