import { NextResponse } from "next/server";
import { testDatabaseConnection } from "@/lib/db/test-connection";

/**
 * 데이터베이스 연결 테스트 API
 * GET /api/test-db
 */
export async function GET() {
  try {
    // 환경 변수 확인 (디버깅용)
    const envCheck = {
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasServiceRoleKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      hasPublicUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasPublicKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    };

    const result = await testDatabaseConnection();
    
    return NextResponse.json({
      ...result,
      envCheck, // 디버깅 정보 포함
    }, {
      status: result.success ? 200 : 500,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: `테스트 중 오류 발생: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
        error: error instanceof Error ? error.stack : String(error),
      },
      { status: 500 }
    );
  }
}
