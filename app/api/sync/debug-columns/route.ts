/**
 * 동기화된 데이터에서 실제 컬럼 구조 확인 API
 * GET /api/sync/debug-columns
 * 실제 동기화가 성공한 경우, 동기화 로그나 데이터베이스에서 컬럼 매핑 정보를 확인합니다.
 */

import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  try {
    // 권한 체크
    await checkPermission(["system:settings", "dashboard:read"]);

    const supabase = await createClient();

    // measurement_business 테이블에서 샘플 데이터 조회
    const { data: sampleData, error: dataError } = await supabase
      .from("measurement_business")
      .select("code, year, period, business_name")
      .limit(5);

    if (dataError) {
      return NextResponse.json(
        { error: "데이터 조회 실패", message: dataError.message },
        { status: 500 }
      );
    }

    // H0432 코드 검색
    const { data: h0432Data, error: h0432Error } = await supabase
      .from("measurement_business")
      .select("*")
      .ilike("code", "%H0432%")
      .limit(5);

    return NextResponse.json({
      success: true,
      sample_data_count: sampleData?.length || 0,
      sample_data: sampleData,
      h0432_search_count: h0432Data?.length || 0,
      h0432_data: h0432Data,
      message: "동기화된 데이터가 정상적으로 저장되었는지 확인하세요.",
    });
  } catch (error) {
    console.error("컬럼 구조 디버깅 API 오류:", error);

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
