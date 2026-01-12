import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth/session";

/**
 * 로그아웃 API 엔드포인트
 * POST /api/auth/logout
 */
export async function POST() {
  try {
    const response = NextResponse.json({ success: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "로그아웃 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
