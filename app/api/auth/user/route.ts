import { getUser } from "@/lib/auth/get-user";
import { NextResponse } from "next/server";

/**
 * 현재 사용자 정보 조회 API
 * GET /api/auth/user
 */
export async function GET() {
  try {
    const user = await getUser();

    if (!user) {
      return NextResponse.json({ user: null }, { status: 200 });
    }

    return NextResponse.json({ user });
  } catch (error: any) {
    console.error("사용자 정보 조회 오류:", error);
    return NextResponse.json(
      { 
        error: "사용자 정보를 불러오는 중 오류가 발생했습니다.",
        details: error?.message || String(error)
      },
      { status: 500 }
    );
  }
}

