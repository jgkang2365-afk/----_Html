/**
 * 로그인 API
 * POST /api/auth/login
 * 쿠키 간섭 방지를 위해 SSR 클라이언트 대신 직접 Supabase JS 클라이언트 사용
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verifyPassword } from "@/lib/utils/password";
import { setSessionCookie } from "@/lib/auth/session";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createSupabaseClient(url, key);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { name, password, rememberMe } = body;
    name = typeof name === 'string' ? name.trim() : name;
    console.log(`[Login API] Login attempt for: '${name}' (password length: ${password?.length})`);

    if (!name || !password) {
      return NextResponse.json(
        { error: "이름과 비밀번호를 입력해주세요." },
        { status: 400 }
      );
    }

    const supabase = getSupabase();

    // 사용자 조회
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, name, role, password_hash")
      .eq("name", name)
      .single();

    console.log(`[Login API] DB query result - user: ${user ? user.name : 'null'}, error: ${userError ? userError.message : 'none'}`);

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
    console.log(`[Login API] Password valid? ${isValid}`);

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
  } catch (error: any) {
    console.error("Login unexpected error:", error);
    return NextResponse.json(
      { 
        error: "로그인 중 오류가 발생했습니다.",
        details: error?.message || String(error)
      },
      { status: 500 }
    );
  }
}
