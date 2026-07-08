import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createClient } from "@/lib/supabase/server";

const MES_QUEUE_ID = 1;
const STALE_TIMEOUT_MINUTES = 5;

/**
 * MES 데이터 즉시 동기화 수동 트리거 API
 *
 * 웹 서버는 MES 프로그램을 직접 실행하지 않습니다.
 * 사내 Windows PC의 mes_daemon.py가 감지할 수 있도록 Supabase 큐에 신호만 남깁니다.
 * POST /api/cron/mes-trigger
 */
export async function POST(request: NextRequest) {
  try {
    // 권한 검증: 관리자 전용 시스템 설정 접근 권한 필요
    await checkPermission("system:settings");
    const supabase = await createClient();

    const timeoutLimit = new Date(
      Date.now() - STALE_TIMEOUT_MINUTES * 60 * 1000
    ).toISOString();

    const { error: resetError } = await supabase
      .from("mes_sync_queue")
      .update({
        status: "idle",
        error_message: `${STALE_TIMEOUT_MINUTES}분 초과 타임아웃으로 자동 리셋됨`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", MES_QUEUE_ID)
      .in("status", ["pending", "running"])
      .lt("updated_at", timeoutLimit);

    if (resetError) {
      console.warn("[MES 트리거 API] 타임아웃 상태 리셋 실패:", resetError.message);
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("mes_sync_queue")
      .update({
        status: "pending",
        error_message: null,
        updated_at: now,
      })
      .eq("id", MES_QUEUE_ID)
      .in("status", ["idle", "success", "error"])
      .select("status, updated_at")
      .maybeSingle();

    if (error) {
      console.error("[MES 트리거 API] 큐 업데이트 실패:", error);
      throw error;
    }

    if (!data) {
      return NextResponse.json(
        {
          success: false,
          error: "이미 다른 MES 동기화 작업이 대기 중이거나 진행 중입니다. 잠시 후 다시 시도해 주세요.",
        },
        { status: 409 }
      );
    }

    console.log("[MES 트리거 API] MES 동기화 요청 신호를 큐에 등록했습니다.");

    return NextResponse.json({
      success: true,
      status: data.status,
      updatedAt: data.updated_at,
      message: "MES 데이터 수동 동기화 요청이 사내 PC 데몬으로 전달되었습니다."
    }, { status: 202 }); // Accepted

  } catch (error: any) {
    console.error("[MES 트리거 API] 수동 동기화 요청 실패:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "동기화 요청 중 내부 오류가 발생했습니다."
    }, { status: error.message === "Unauthorized" ? 401 : error.message === "Forbidden" ? 403 : 500 });
  }
}

/**
 * MES 데이터 즉시 동기화 상태 조회 API
 * GET /api/cron/mes-trigger
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 검증: 관리자 전용 시스템 설정 접근 권한 필요
    await checkPermission("system:settings");
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("mes_sync_queue")
      .select("status, error_message, updated_at")
      .eq("id", MES_QUEUE_ID)
      .maybeSingle();

    if (error) {
      console.error("[MES 트리거 API] 큐 상태 조회 실패:", error);
      throw error;
    }

    return NextResponse.json({
      success: true,
      status: data?.status ?? "idle",
      error: data?.error_message ?? null,
      updatedAt: data?.updated_at ?? null,
    });

  } catch (error: any) {
    console.error("[MES 트리거 API] 상태 조회 실패:", error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : "상태 조회 중 내부 오류가 발생했습니다."
    }, { status: error.message === "Unauthorized" ? 401 : error.message === "Forbidden" ? 403 : 500 });
  }
}
