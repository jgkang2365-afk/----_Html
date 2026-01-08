import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/**
 * 로그아웃 API 엔드포인트
 * POST /api/auth/logout
 */
export async function POST() {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: "로그아웃 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

