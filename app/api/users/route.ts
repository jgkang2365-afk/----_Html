/**
 * 사용자 관리 API
 * GET: 사용자 목록 조회
 * POST: 새 사용자 생성
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashPassword } from "@/lib/utils/password";
import { getSession } from "@/lib/auth/session";

/**
 * 사용자 목록 조회
 * GET /api/users
 */
export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    if (!["관리자", "DB관리"].includes(session.role)) {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const supabase = await createClient();

    const { data: users, error } = await supabase
      .from("users")
      .select("id, name, role, survey_code, created_at, updated_at")
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: "사용자 목록을 불러오는 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ users: users || [] });
  } catch (error) {
    console.error("Get users error:", error);
    return NextResponse.json(
      { error: "사용자 목록을 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 새 사용자 생성
 * POST /api/users
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    if (!["관리자", "DB관리"].includes(session.role)) {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const body = await request.json();
    const { name, role, password, survey_code } = body;

    if (!name || !role) {
      return NextResponse.json(
        { error: "이름과 역할을 입력해주세요." },
        { status: 400 }
      );
    }

    if (!["관리자", "사용자", "DB관리"].includes(role)) {
      return NextResponse.json(
        { error: "역할은 '관리자', '사용자', 'DB관리' 중 하나여야 합니다." },
        { status: 400 }
      );
    }

    // 비밀번호가 제공된 경우 검증
    if (password && password.length < 4) {
      return NextResponse.json(
        { error: "비밀번호는 최소 4자 이상이어야 합니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 중복 체크
    const { data: existingUser } = await supabase
      .from("users")
      .select("id")
      .eq("name", name)
      .single();

    if (existingUser) {
      return NextResponse.json(
        { error: "이미 존재하는 사용자 이름입니다." },
        { status: 400 }
      );
    }

    // 비밀번호 해싱 (비밀번호가 제공된 경우만)
    const passwordHash = password ? await hashPassword(password) : null;

    // 사용자 생성
    const { data: newUser, error: insertError } = await supabase
      .from("users")
      .insert({
        name,
        role,
        password_hash: passwordHash,
        survey_code: survey_code || null,
      })
      .select("id, name, role, survey_code, created_at")
      .single();

    if (insertError) {
      console.error("Insert error details:", insertError);
      // 더 구체적인 에러 메시지 제공
      const errorMessage = insertError.message || "사용자 생성에 실패했습니다.";
      return NextResponse.json(
        { error: errorMessage },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user: newUser,
      message: "사용자가 생성되었습니다.",
    });
  } catch (error) {
    console.error("Create user error:", error);
    return NextResponse.json(
      { error: "사용자 생성 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
