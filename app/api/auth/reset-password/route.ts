/**
 * 관리자 비밀번호 리셋 API
 * POST /api/auth/reset-password
 * 관리자만 사용 가능
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashPassword } from "@/lib/utils/password";
import { getSession } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    if (session.role !== "관리자") {
      return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
    }

    const body = await request.json();
    const { userName, newPassword } = body;

    if (!userName || !newPassword) {
      return NextResponse.json(
        { error: "사용자 이름과 새 비밀번호를 입력해주세요." },
        { status: 400 }
      );
    }

    if (newPassword.length < 4) {
      return NextResponse.json(
        { error: "비밀번호는 최소 4자 이상이어야 합니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 대상 사용자 조회
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, name")
      .eq("name", userName)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    // 비밀번호 해싱
    const passwordHash = await hashPassword(newPassword);

    // 비밀번호 업데이트
    const { error: updateError } = await supabase
      .from("users")
      .update({ password_hash: passwordHash })
      .eq("id", user.id);

    if (updateError) {
      return NextResponse.json(
        { error: "비밀번호 리셋에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${userName}의 비밀번호가 리셋되었습니다.`,
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json(
      { error: "비밀번호 리셋 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
