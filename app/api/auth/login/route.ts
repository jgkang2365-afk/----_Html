/**
 * 로그인 API
 * POST /api/auth/login
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashPassword, verifyPassword } from "@/lib/utils/password";
import { setSessionCookie } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, password, rememberMe } = body;

    if (!name || !password) {
      return NextResponse.json(
        { error: "이름과 비밀번호를 입력해주세요." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 사용자 조회
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, name, role, password_hash")
      .eq("name", name)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: "이름 또는 비밀번호가 올바르지 않습니다." },
        { status: 401 }
      );
    }

    if (!user.password_hash) {
      return NextResponse.json(
        { error: "비밀번호가 설정되지 않았습니다. 관리자에게 문의하세요." },
        { status: 401 }
      );
    }

    // 비밀번호 검증
    const isValid = await verifyPassword(password, user.password_hash);

    if (!isValid) {
      return NextResponse.json(
        { error: "이름 또는 비밀번호가 올바르지 않습니다." },
        { status: 401 }
      );
    }

    // 세션 생성
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        role: user.role,
      },
    });

    // 세션 쿠키 설정
    setSessionCookie(response, {
      userId: user.id,
      name: user.name,
      role: user.role as "관리자" | "사용자",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "로그인 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
