import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

/**
 * 업종분류 수정 API
 * PUT /api/business-categories/[id]
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }

    if (session.role !== "관리자") {
      return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
    }

    const categoryId = parseInt(params.id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: "올바르지 않은 업종분류 ID입니다." }, { status: 400 });
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

    // 업종분류 존재 확인
    const { data: existingCategory, error: fetchError } = await supabase
      .from("business_category")
      .select("id, name")
      .eq("id", categoryId)
      .single();

    if (fetchError || !existingCategory) {
      return NextResponse.json({ error: "업종분류를 찾을 수 없습니다." }, { status: 404 });
    }

    // 이름이 변경된 경우 중복 확인
    if (existingCategory.name !== name.trim()) {
      const { data: duplicateCategory } = await supabase
        .from("business_category")
        .select("id")
        .eq("name", name.trim())
        .maybeSingle();

      if (duplicateCategory) {
        return NextResponse.json(
          { error: "이미 존재하는 업종분류명입니다." },
          { status: 409 }
        );
      }
    }

    // 업종분류 수정
    const { data: updatedCategory, error: updateError } = await supabase
      .from("business_category")
      .update({
        name: name.trim(),
        display_order: parseInt(display_order) || 0,
      })
      .eq("id", categoryId)
      .select()
      .single();

    if (updateError) {
      console.error("업종분류 수정 오류:", updateError);
      return NextResponse.json(
        { error: "업종분류 수정 중 오류가 발생했습니다.", details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      category: updatedCategory,
      message: "업종분류가 수정되었습니다.",
    });
  } catch (error) {
    console.error("업종분류 수정 API 오류:", error);

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
        error: "업종분류 수정 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * 업종분류 삭제 API
 * DELETE /api/business-categories/[id]
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
      return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
    }

    const categoryId = parseInt(params.id, 10);

    if (isNaN(categoryId)) {
      return NextResponse.json({ error: "올바르지 않은 업종분류 ID입니다." }, { status: 400 });
    }

    const supabase = await createClient();

    // 업종분류 존재 확인
    const { data: category, error: fetchError } = await supabase
      .from("business_category")
      .select("id, name")
      .eq("id", categoryId)
      .single();

    if (fetchError || !category) {
      return NextResponse.json({ error: "업종분류를 찾을 수 없습니다." }, { status: 404 });
    }

    // 사용 중인 측정일지 확인 (선택사항 - 경고만 표시)
    const { data: journalsUsingCategory, error: journalCheckError } = await supabase
      .from("measurement_journal")
      .select("id")
      .eq("business_category", category.name)
      .limit(1);

    if (journalCheckError && journalCheckError.code !== "PGRST116") {
      console.warn("측정일지 사용 여부 확인 오류:", journalCheckError);
    }

    // 업종분류 삭제
    const { error: deleteError } = await supabase
      .from("business_category")
      .delete()
      .eq("id", categoryId);

    if (deleteError) {
      console.error("업종분류 삭제 오류:", deleteError);
      return NextResponse.json(
        { error: "업종분류 삭제 중 오류가 발생했습니다.", details: deleteError.message },
        { status: 500 }
      );
    }

    const warningMessage =
      journalsUsingCategory && journalsUsingCategory.length > 0
        ? ` ${category.name} 업종분류가 삭제되었습니다. 이 업종분류를 사용 중인 측정일지가 ${journalsUsingCategory.length}개 이상 있습니다.`
        : `${category.name} 업종분류가 삭제되었습니다.`;

    return NextResponse.json({
      success: true,
      message: warningMessage,
    });
  } catch (error) {
    console.error("업종분류 삭제 API 오류:", error);

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
        error: "업종분류 삭제 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
