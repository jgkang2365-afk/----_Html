/**
 * 사용자 관리 API
 * GET: 사용자 목록 조회
 * POST: 새 사용자 생성
 */

import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';

import { createClient } from "@/lib/supabase/server";
import { hashPassword } from "@/lib/utils/password";
import { getSession } from "@/lib/auth/session";

/**
 * 사용자 목록 조회
 * GET /api/users
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    const supabase = await createClient();

    // 1차 조회 시도: is_national_support_manager 포함
    const primaryQuery = await supabase
      .from("users")
      .select("id, name, role, job, survey_code, mobile, email, is_journal_manager, is_national_support_manager, is_active, created_at, updated_at")
      .order("name", { ascending: true });

    let finalUsers = [];

    if (primaryQuery.error) {
      console.warn("[API /api/users] is_national_support_manager 컬럼 부재로 fallback 조회 실행");
      
      // 2차 조회 시도: 해당 컬럼 제외 (레거시 대응)
      const fallbackQuery = await supabase
        .from("users")
        .select("id, name, role, job, survey_code, mobile, email, is_journal_manager, is_active, created_at, updated_at")
        .order("name", { ascending: true });

      if (fallbackQuery.error) {
        console.error("[API /api/users] fallback 조회 오류:", fallbackQuery.error);
        return NextResponse.json(
          { error: "사용자 목록을 불러오는 중 오류가 발생했습니다." },
          { status: 500 }
        );
      }
      
      // 누락된 권한 필드를 false로 보정
      finalUsers = (fallbackQuery.data || []).map(u => ({
        ...u,
        is_national_support_manager: false
      }));
    } else {
      finalUsers = primaryQuery.data || [];
    }

    return NextResponse.json({ users: finalUsers });
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

    if (session.role !== "관리자") {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const body = await request.json();
    const { name, role, password, survey_code, job, mobile, email, is_journal_manager, is_national_support_manager } = body;

    if (!name || !role) {
      return NextResponse.json(
        { error: "이름과 역할을 입력해주세요." },
        { status: 400 }
      );
    }

    if (!["관리자", "사용자"].includes(role)) {
      return NextResponse.json(
        { error: "역할은 '관리자', '사용자' 중 하나여야 합니다." },
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
      .maybeSingle(); // single() 대신 maybeSingle() 사용 (없어도 에러 안나게)

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
        job: job || "측정",
        mobile: mobile || null,
        email: email || null,
        is_journal_manager: !!is_journal_manager,
        is_national_support_manager: !!is_national_support_manager,
        is_active: true,
      })
      .select("id, name, role, job, survey_code, mobile, email, is_journal_manager, is_national_support_manager, is_active, created_at")
      .single();

    if (insertError) {
      console.error("Insert error details:", insertError);
      let errorMsg = insertError.message || "사용자 생성에 실패했습니다.";
      if (insertError.message?.includes("is_national_support_manager") || insertError.message?.includes("column")) {
        errorMsg = "사용자 생성 실패: '국고 일괄' 권한 컬럼이 데이터베이스에 없습니다. Supabase SQL Editor에서 마이그레이션(046_add_national_support_manager_to_users.sql)을 실행해주시기 바랍니다.";
      }
      return NextResponse.json(
        { error: errorMsg },
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
    const errorMsg = error instanceof Error ? error.message : "사용자 생성 중 오류가 발생했습니다.";
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}
