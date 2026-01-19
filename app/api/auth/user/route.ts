import { getUser } from "@/lib/auth/get-user";
import { NextResponse } from "next/server";

/**
 * 현재 사용자 정보 조회 API
 * GET /api/auth/user
 */
export async function GET() {
  try {
    console.log("[API /api/auth/user] 사용자 정보 조회 시작");
    
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

    console.log("[API /api/auth/user] getUser 호출 시작");
    const user = await getUser();
    console.log("[API /api/auth/user] getUser 호출 완료, user:", user ? "존재" : "null");

    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    return NextResponse.json({ user });
  } catch (error: any) {
    console.error("[API /api/auth/user] ===== 예외 발생 =====");
    console.error("[API /api/auth/user] 오류 타입:", typeof error);
    console.error("[API /api/auth/user] 오류 이름:", error?.name);
    console.error("[API /api/auth/user] 오류 메시지:", error?.message);
    console.error("[API /api/auth/user] 오류 스택:", error?.stack);
    
    // Supabase 에러인 경우
    if (error?.code || error?.hint || error?.details) {
      console.error("[API /api/auth/user] Supabase 에러 상세:", {
        code: error.code,
        message: error.message,
        hint: error.hint,
        details: error.details,
      });
    }
    
    return NextResponse.json(
      { 
        error: "사용자 정보를 불러오는 중 오류가 발생했습니다.",
        details: error?.message || String(error),
        // 개발 환경에서만 스택 트레이스 포함
        ...(process.env.NODE_ENV === "development" && error?.stack ? { 
          stack: error.stack.substring(0, 500) // 스택 트레이스 일부만 포함
        } : {})
      },
      { status: 500 }
    );
  }
}

