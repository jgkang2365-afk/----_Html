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
    const { role, survey_code, job, mobile, email, is_journal_manager, is_national_support_manager, is_designated_office_report_manager, is_active } = body;

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
      .select("id, name, is_active")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
    }

    let finalUpdatedUser;

    // 1차 업데이트 시도: is_national_support_manager 포함
    const primaryUpdate = await supabase
      .from("users")
      .update({
        ...(role && { role }),
        ...(job && { job }),
        survey_code: survey_code || null,
        mobile: mobile || null,
        email: email || null,
        is_journal_manager: !!is_journal_manager,
        is_national_support_manager: !!is_national_support_manager,
        is_designated_office_report_manager: !!is_designated_office_report_manager,
        ...(is_active !== undefined && { is_active }),
      })
      .eq("id", userId)
      .select("id, name, role, job, survey_code, mobile, email, is_journal_manager, is_national_support_manager, is_designated_office_report_manager, is_active, updated_at")
      .maybeSingle();

    if (primaryUpdate.error) {
      console.warn("[API PATCH /api/users] is_national_support_manager 업데이트 실패, fallback 업데이트 기동. 사유:", primaryUpdate.error.message);
      
      // 2차 업데이트 시도: 해당 컬럼 제외 (레거시 대응)
      const fallbackUpdate = await supabase
        .from("users")
        .update({
          ...(role && { role }),
          ...(job && { job }),
          survey_code: survey_code || null,
          mobile: mobile || null,
          email: email || null,
          is_journal_manager: !!is_journal_manager,
          ...(is_active !== undefined && { is_active }),
        })
        .eq("id", userId)
        .select("id, name, role, job, survey_code, mobile, email, is_journal_manager, is_active, updated_at")
        .maybeSingle();

      if (fallbackUpdate.error) {
        console.error("[API PATCH /api/users] fallback 업데이트 실패:", fallbackUpdate.error);
        return NextResponse.json(
          { error: "사용자 수정에 실패했습니다." },
          { status: 500 }
        );
      }
      
      finalUpdatedUser = {
        ...fallbackUpdate.data,
        is_national_support_manager: false,
        is_designated_office_report_manager: false
      };
    } else {
      finalUpdatedUser = primaryUpdate.data;
    }

    return NextResponse.json({
      success: true,
      user: finalUpdatedUser,
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

    // 1. 관련 데이터 수동 연쇄 삭제 (외래 키 제약 조건 오류 방지)
    // measurement_target_business 테이블의 담당자(measurer_id) 연결 해제
    await supabase
      .from("measurement_target_business")
      .update({ measurer_id: null })
      .eq("measurer_id", userId);

    // quota_memos 테이블 삭제
    await supabase.from("quota_memos").delete().eq("user_id", userId);
    
    // notifications 테이블 삭제 (이미 CASCADE 설정되어 있을 수 있으나 안전을 위해 수행)
    await supabase.from("notifications").delete().eq("user_id", userId);

    // 2. 사용자 삭제
    const { error: deleteError } = await supabase.from("users").delete().eq("id", userId);

    if (deleteError) {
      console.error("Delete user database error:", deleteError);
      return NextResponse.json(
        { error: `사용자 삭제에 실패했습니다: ${deleteError.message}` },
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
