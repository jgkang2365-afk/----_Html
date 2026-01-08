/**
 * Excel 파일 동기화 테스트용 API 엔드포인트
 * 개발 환경에서만 사용 (권한 체크 없음)
 * POST /api/test-sync - 모든 Excel 파일 동기화
 */

import { NextResponse } from "next/server";
import { syncBusinessInfo, syncMeasurementBusiness, syncAllFiles } from "@/lib/sync/excel-sync";

/**
 * POST /api/test-sync
 * 테스트용 동기화 (권한 체크 없음)
 */
export async function POST(request: Request) {
  try {
    // 개발 환경에서만 허용
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "이 엔드포인트는 개발 환경에서만 사용할 수 있습니다." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const fileType = searchParams.get("type");

    let results;

    if (fileType === "business-info") {
      // 사업장정보.xlsx만 동기화
      const result = await syncBusinessInfo();
      results = [result];
    } else if (fileType === "measurement-business") {
      // 측정사업장.xlsx만 동기화
      const result = await syncMeasurementBusiness();
      results = [result];
    } else {
      // 모든 파일 동기화
      results = await syncAllFiles();
    }

    const hasError = results.some((r) => !r.success);

    return NextResponse.json(
      {
        success: !hasError,
        results,
        message: "테스트용 동기화가 완료되었습니다.",
      },
      { status: hasError ? 500 : 200 }
    );
  } catch (error) {
    console.error("테스트 동기화 API 오류:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "동기화 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/test-sync
 * 테스트용 동기화 로그 조회 (권한 체크 없음)
 */
export async function GET() {
  try {
    // 개발 환경에서만 허용
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "이 엔드포인트는 개발 환경에서만 사용할 수 있습니다." },
        { status: 403 }
      );
    }

    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();

    const { data: logs, error } = await supabase
      .from("sync_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error("동기화 로그 조회 실패:", error);
      return NextResponse.json(
        { error: "동기화 로그를 불러오는 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ logs: logs || [] });
  } catch (error) {
    console.error("테스트 동기화 로그 API 오류:", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "동기화 로그를 불러오는 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}

