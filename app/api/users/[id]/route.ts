/**
 * 사용자 개별 관리 API
 * PATCH: 사용자 수정
 * DELETE: 사용자 삭제
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

/**
 * 사용자 수정
 * PATCH /api/users/[id]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    if (session.role !== "관리자") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const userId = parseInt(params.id);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "올바르지 않은 사용자 ID입니다." }, { status: 400 });
    }

    const body = await request.json();
    const { role, survey_code } = body;

    if (role && !["관리자", "사용자"].includes(role)) {
      return NextResponse.json(
        { error: "역할은 '관리자', '사용자' 중 하나여야 합니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 사용자 존재 확인
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, name")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    // 사용자 수정
    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({
        ...(role && { role }),
        survey_code: survey_code || null,
      })
      .eq("id", userId)
      .select("id, name, role, survey_code, updated_at")
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: "사용자 수정에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      user: updatedUser,
      message: "사용자 정보가 수정되었습니다.",
    });
  } catch (error) {
    console.error("Update user error:", error);
    return NextResponse.json(
      { error: "사용자 수정 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 사용자 삭제
 * DELETE /api/users/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    if (session.role !== "관리자") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const userId = parseInt(params.id);

    if (isNaN(userId)) {
      return NextResponse.json({ error: "올바르지 않은 사용자 ID입니다." }, { status: 400 });
    }

    // 자기 자신은 삭제할 수 없도록 체크
    if (session.userId === userId) {
      return NextResponse.json(
        { error: "자기 자신은 삭제할 수 없습니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 사용자 존재 확인
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, name")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    // 사용자 삭제
    const { error: deleteError } = await supabase.from("users").delete().eq("id", userId);

    if (deleteError) {
      return NextResponse.json(
        { error: "사용자 삭제에 실패했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `${user.name} 사용자가 삭제되었습니다.`,
    });
  } catch (error) {
    console.error("Delete user error:", error);
    return NextResponse.json(
      { error: "사용자 삭제 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
