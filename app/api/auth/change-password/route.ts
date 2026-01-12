/**
 * 비밀번호 변경 API
 * POST /api/auth/change-password
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashPassword, verifyPassword } from "@/lib/utils/password";
import { getSession } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "현재 비밀번호와 새 비밀번호를 입력해주세요." },
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

    // 현재 사용자 정보 조회
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, password_hash")
      .eq("id", session.userId)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    if (!user.password_hash) {
      return NextResponse.json(
        { error: "비밀번호가 설정되지 않았습니다." },
        { status: 400 }
      );
    }

    // 현재 비밀번호 검증
    const isValid = await verifyPassword(currentPassword, user.password_hash);

    if (!isValid) {
      return NextResponse.json(
        { error: "현재 비밀번호가 올바르지 않습니다." },
        { status: 401 }
      );
    }

    // 새 비밀번호 해싱
    const newPasswordHash = await hashPassword(newPassword);

    // 비밀번호 업데이트
    const { error: updateError } = await supabase
      .from("users")
      .update({ password_hash: newPasswordHash })
      .eq("id", session.userId);

    if (updateError) {
      return NextResponse.json(
        { error: "비밀번호 변경에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "비밀번호가 변경되었습니다." });
  } catch (error) {
    console.error("Change password error:", error);
    return NextResponse.json(
      { error: "비밀번호 변경 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
