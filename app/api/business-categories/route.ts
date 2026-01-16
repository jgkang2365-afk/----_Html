import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";

/**
 * 업종분류 목록 조회 API
 * GET /api/business-categories
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("journal:read");

    const supabase = await createClient();

    // 업종분류 목록 조회 (display_order 오름차순)
    const { data: categories, error } = await supabase
      .from("business_category")
      .select("id, name, display_order, created_at")
      .order("display_order", { ascending: true });

    if (error) {
      // 테이블이 없으면 하드코딩된 목록 반환 (마이그레이션 미실행 시)
      if (error.code === "PGRST205") {
        console.warn("업종분류 테이블이 존재하지 않습니다. 마이그레이션을 실행해주세요.");
        return NextResponse.json({
          categories: [
            { id: 1, name: "건설" },
            { id: 2, name: "교육" },
            { id: 3, name: "공업사" },
            { id: 4, name: "도정" },
            { id: 5, name: "병원" },
            { id: 6, name: "서비스" },
            { id: 7, name: "수리" },
            { id: 8, name: "실험실" },
            { id: 9, name: "인쇄" },
            { id: 10, name: "정비" },
            { id: 11, name: "제조" },
            { id: 12, name: "환경" },
          ],
        });
      }

      console.error("업종분류 목록 조회 오류:", error);
      return NextResponse.json(
        { error: "업종분류 목록을 불러오는 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      categories: categories || [],
    });
  } catch (error) {
    console.error("업종분류 목록 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json(
          { error: "로그인이 필요합니다." },
          { status: 401 }
        );
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { error: "권한이 없습니다." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      {
        error: "업종분류 목록 조회 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * 업종분류 생성 API
 * POST /api/business-categories
 */
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
    const { name, display_order } = body;

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: "업종분류명을 입력해주세요." },
        { status: 400 }
      );
    }

    if (display_order === undefined || display_order === null) {
      return NextResponse.json(
        { error: "표시 순서를 입력해주세요." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 중복 확인
    const { data: existingCategory } = await supabase
      .from("business_category")
      .select("id")
      .eq("name", name.trim())
      .maybeSingle();

    if (existingCategory) {
      return NextResponse.json(
        { error: "이미 존재하는 업종분류명입니다." },
        { status: 409 }
      );
    }

    // 업종분류 생성
    const { data: newCategory, error: insertError } = await supabase
      .from("business_category")
      .insert({
        name: name.trim(),
        display_order: parseInt(display_order) || 0,
      })
      .select()
      .single();

    if (insertError) {
      console.error("업종분류 생성 오류:", insertError);
      return NextResponse.json(
        { error: "업종분류 생성 중 오류가 발생했습니다.", details: insertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      category: newCategory,
      message: "업종분류가 생성되었습니다.",
    });
  } catch (error) {
    console.error("업종분류 생성 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json(
          { error: "로그인이 필요합니다." },
          { status: 401 }
        );
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { error: "권한이 없습니다." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      {
        error: "업종분류 생성 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
