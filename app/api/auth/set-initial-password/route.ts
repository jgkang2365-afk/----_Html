/**
 * 최초 비밀번호 설정 API
 * POST /api/auth/set-initial-password
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashPassword, verifyPassword } from "@/lib/utils/password";
import { setSessionCookie } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, password } = body;

    if (!name || !password) {
      return NextResponse.json(
        { error: "이름과 비밀번호를 입력해주세요." },
        { status: 400 }
      );
    }

    if (password.length < 4) {
      return NextResponse.json(
        { error: "비밀번호는 최소 4자 이상이어야 합니다." },
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
        { error: "사용자를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // 이미 비밀번호가 설정되어 있으면 일반 로그인 API를 사용하도록 안내
    if (user.password_hash) {
      return NextResponse.json(
        { error: "이미 비밀번호가 설정되어 있습니다. 로그인 페이지를 사용하세요." },
        { status: 400 }
      );
    }

    // 비밀번호 해싱
    const passwordHash = await hashPassword(password);

    // 비밀번호 설정
    const { error: updateError } = await supabase
      .from("users")
      .update({ password_hash: passwordHash })
      .eq("id", user.id);

    if (updateError) {
      return NextResponse.json(
        { error: "비밀번호 설정에 실패했습니다." },
        { status: 500 }
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
    console.error("Set initial password error:", error);
    return NextResponse.json(
      { error: "비밀번호 설정 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
