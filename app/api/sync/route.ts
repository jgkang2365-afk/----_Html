/**
 * Excel 파일 동기화 API 엔드포인트
 * POST /api/sync - 모든 Excel 파일 동기화
 * POST /api/sync/business-info - 사업장정보.xls만 동기화
 * POST /api/sync/measurement-business - 측정사업장.xls만 동기화
 */

import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { syncBusinessInfo, syncMeasurementBusiness, syncAllFiles } from "@/lib/sync/excel-sync";
import { verifyDataConsistency } from "@/lib/sync/verification";

/**
 * POST /api/sync
 * 모든 Excel 파일 동기화
 */
export async function POST(request: Request) {
  try {
    // 권한 체크 (관리자 또는 사용자 모두 동기화 가능)
    await checkPermission(["system:settings", "dashboard:read"]);

    const { searchParams } = new URL(request.url);
    const fileType = searchParams.get("type");

    let results;

    if (fileType === "business-info") {
      // 사업장정보.xls만 동기화
      const result = await syncBusinessInfo();
      results = [result];
    } else if (fileType === "measurement-business") {
      // 측정사업장.xls만 동기화
      const result = await syncMeasurementBusiness();
      results = [result];
    } else {
      // 모든 파일 동기화
      results = await syncAllFiles();
    }

    const hasError = results.some((r) => !r.success);

    // 디버깅: 결과 상세 로깅
    console.log("[동기화 API] 동기화 결과:", {
      results,
      hasError,
      successCount: results.filter(r => r.success).length,
      errorCount: results.filter(r => !r.success).length
    });

    // [ADD] 데이터 정합성 검증 실행
    // 동기화 후 반드시 실행하여 최신 상태 검증
    try {
      await verifyDataConsistency();
      console.log("[동기화 API] 데이터 정합성 검증 완료");
    } catch (verError) {
      console.error("[동기화 API] 데이터 정합성 검증 실패:", verError);
      // 검증 실패는 전체 동기화 실패로 간주하지 않음 (로그만 남김)
    }

    return NextResponse.json(
      {
        success: !hasError,
        results,
      },
      { status: hasError ? 500 : 200 }
    );
  } catch (error) {
    console.error("동기화 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json(
          { success: false, error: "로그인이 필요합니다." },
          { status: 401 }
        );
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { success: false, error: "권한이 없습니다." },
          { status: 403 }
        );
      }
    }

    const errorMessage = error instanceof Error ? error.message : "동기화 중 오류가 발생했습니다.";
    console.error("상세 오류:", errorMessage);

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        details: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sync
 * 최근 동기화 로그 및 데이터 정합성 이슈 조회
 */
export async function GET() {
  try {
    // 권한 체크 (대시보드 읽기 권한 필요)
    await checkPermission("dashboard:read");

    const { createAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createAdminClient();

    // 1. 동기화 로그 조회
    const { data: logs, error: logError } = await supabase
      .from("sync_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);

    if (logError) {
      console.error("동기화 로그 조회 실패:", logError);
      return NextResponse.json(
        { error: "동기화 로그를 불러오는 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // 2. 데이터 정합성 이슈 조회
    const { data: issues, error: issueError } = await supabase
      .from("data_verification_issues")
      .select("*")
      .order("created_at", { ascending: false });

    if (issueError) {
      console.warn("데이터 정합성 이슈 조회 실패 (테이블이 없을 수 있음):", issueError);
    }

    return NextResponse.json({
      logs: logs || [],
      verification_issues: issues || []
    });

  } catch (error) {
    console.error("동기화 로그 API 오류:", error);

    if (error instanceof Error && error.message.includes("redirect")) {
      throw error;
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "동기화 로그를 불러오는 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
