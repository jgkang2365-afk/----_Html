import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { verifyDataConsistency } from "@/lib/sync/verification";

/**
 * POST /api/sync/exclude
 * 데이터 정합성 검증 제외(예외 등록) 처리 API
 */
export async function POST(request: NextRequest) {
  try {
    // 권한 체크 (동기화 및 설정 수정 권한 필요)
    await checkPermission(["system:settings", "dashboard:read"]);

    const body = await request.json();
    const { code, issue_type } = body;

    if (!code || !issue_type) {
      return NextResponse.json(
        { success: false, error: "필수 파라미터(code, issue_type)가 누락되었습니다." },
        { status: 400 }
      );
    }

    const { createAdminClient } = await import("@/lib/supabase/admin");
    const supabase = createAdminClient();

    // 제외 테이블에 예외 등록 (Upsert 처리)
    const { error: insertError } = await supabase
      .from("data_verification_exclusions")
      .upsert({
        code,
        issue_type
      }, {
        onConflict: "code,issue_type"
      });

    if (insertError) {
      console.error("[제외 API] 예외 등록 실패:", insertError);
      return NextResponse.json(
        { success: false, error: `제외 등록 실패: ${insertError.message}` },
        { status: 500 }
      );
    }

    console.log(`[제외 API] 제외 완료 - 코드: ${code}, 유형: ${issue_type}`);

    // 예외가 등록되었으므로 데이터 정합성 검증을 즉시 재실행하여 알림 및 측정일지 특이사항 동기화
    try {
      await verifyDataConsistency(supabase);
      console.log("[제외 API] 데이터 정합성 검증 재실행 성공");
    } catch (verError) {
      console.error("[제외 API] 데이터 정합성 검증 재실행 실패:", verError);
    }

    return NextResponse.json({ success: true, message: "성공적으로 제외 처리되었습니다." });

  } catch (error) {
    console.error("[제외 API] 에러 발생:", error);
    
    if (error instanceof Error && error.message.includes("redirect")) {
      throw error;
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "제외 처리 중 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}
