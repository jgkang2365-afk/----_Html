import { getUser } from "@/lib/auth/get-user";
import { NextResponse } from "next/server";

/**
 * 현재 사용자 정보 조회 API
 * GET /api/auth/user
 */
export async function GET() {
  try {
    // 환경 변수 확인
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.error("[API /api/auth/user] Supabase 환경 변수가 설정되지 않았습니다.");
      return NextResponse.json(
        { 
          error: "서버 설정 오류",
          details: "Supabase 환경 변수가 설정되지 않았습니다. .env.local 파일을 확인하세요."
        },
        { status: 500 }
      );
    }

    const user = await getUser();

    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    return NextResponse.json({ user });
  } catch (error: any) {
    console.error("[API /api/auth/user] 사용자 정보 조회 오류:", error);
    console.error("[API /api/auth/user] 에러 스택:", error?.stack);
    console.error("[API /api/auth/user] 에러 메시지:", error?.message);
    
    return NextResponse.json(
      { 
        error: "사용자 정보를 불러오는 중 오류가 발생했습니다.",
        details: error?.message || String(error),
        // 개발 환경에서만 스택 트레이스 포함
        ...(process.env.NODE_ENV === "development" && error?.stack ? { stack: error.stack } : {})
      },
      { status: 500 }
    );
  }
}

