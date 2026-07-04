import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { BackgroundTasks } from "@/lib/scheduler/background-tasks";

/**
 * MES 데이터 즉시 동기화 수동 트리거 API
 * POST /api/cron/mes-trigger
 */
export async function POST(request: NextRequest) {
  try {
    // 권한 검증: 관리자 전용 시스템 설정 접근 권한 필요
    await checkPermission("system:settings");

    console.log("[MES 트리거 API] 관리자에 의한 수동 즉시 동기화 요청 수신.");

    // 비동기로 파이썬 다운로드 스크립트 실행 (즉시 응답하여 타임아웃 방지)
    // 14:00 최종 체크가 아니므로 미등록 경고 알림은 false로 설정
    BackgroundTasks.getInstance().runMesDownloadScript(false)
      .then((success) => {
        console.log(`[MES 트리거 API] 수동 동기화 실행 완료. 성공 여부: ${success}`);
      })
      .catch((err) => {
        console.error("[MES 트리거 API] 수동 동기화 실행 중 예외 발생:", err);
      });

    return NextResponse.json({
      success: true,
      message: "MES 데이터 수동 동기화 작업이 백그라운드에서 시작되었습니다. 완료 시 알림이 발송됩니다."
    }, { status: 202 }); // Accepted

  } catch (error: any) {
    console.error("[MES 트리거 API] 수동 동기화 요청 실패:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "동기화 요청 중 내부 오류가 발생했습니다."
    }, { status: error.message === "Unauthorized" ? 401 : error.message === "Forbidden" ? 403 : 500 });
  }
}
