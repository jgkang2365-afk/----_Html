import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";

/**
 * 건강디딤돌 신청결과 수정 API
 * PATCH /api/businesses/national-support/[id]
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await checkPermission("journal:write");

    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const id = parseInt(params.id);
    if (isNaN(id)) {
      return NextResponse.json(
        { error: "유효하지 않은 ID입니다." },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { code, year, period, application_status, result, national_support_status } = body;

    // 필수 필드 검증
    if (!code || !year || !period) {
      return NextResponse.json(
        { error: "코드, 측정년도, 측정주기는 필수입니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 신청결과에 따라 국고지원 상태 자동 계산
    let calculatedStatus: "지원" | "비대상" | null = national_support_status;
    if (!calculatedStatus) {
      // '비대상'이 아니면서 '대상'을 포함하는 경우에만 지원으로 설정
      if (result && (result === "대상" || (result.includes("대상") && !result.includes("비대상")))) {
        calculatedStatus = "지원";
      } else if (result || application_status) {
        calculatedStatus = "비대상";
      }
    }

    // 업데이트 데이터 준비
    const updateData: any = {
      code,
      year: parseInt(year),
      period,
      application_status: application_status || null,
      result: result || null,
      national_support_status: calculatedStatus,
      updated_at: new Date().toISOString(),
    };

    // 기존 레코드 확인
    const { data: existing, error: checkError } = await supabase
      .from("national_support_application")
      .select("id, code, year, period")
      .eq("id", id)
      .maybeSingle();

    if (checkError) {
      console.error("건강디딤돌 신청결과 조회 오류:", checkError);
      return NextResponse.json(
        { error: "건강디딤돌 신청결과를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: "건강디딤돌 신청결과를 찾을 수 없습니다." },
        { status: 404 }
      );
    }

    // code, year, period 조합이 변경되는 경우 중복 체크
    if (existing.code !== code || existing.year !== parseInt(year) || existing.period !== period) {
      const { data: duplicate, error: duplicateError } = await supabase
        .from("national_support_application")
        .select("id")
        .eq("code", code)
        .eq("year", parseInt(year))
        .eq("period", period)
        .neq("id", id)
        .maybeSingle();

      if (duplicateError) {
        console.error("중복 체크 오류:", duplicateError);
        return NextResponse.json(
          { error: "중복 체크 중 오류가 발생했습니다." },
          { status: 500 }
        );
      }

      if (duplicate) {
        return NextResponse.json(
          { error: "이미 같은 코드/년도/주기 조합의 신청결과가 존재합니다." },
          { status: 400 }
        );
      }
    }

    // 업데이트
    const { data: updated, error: updateError } = await supabase
      .from("national_support_application")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("건강디딤돌 신청결과 업데이트 오류:", updateError);
      return NextResponse.json(
        { error: "건강디딤돌 신청결과를 업데이트하는 중 오류가 발생했습니다.", details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error: any) {
    console.error("건강디딤돌 신청결과 수정 API 오류:", error);
    return NextResponse.json(
      { error: error.message || "건강디딤돌 신청결과를 수정하는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}

/**
 * 건강디딤돌 신청결과 삭제 API
 * DELETE /api/businesses/national-support/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await checkPermission("journal:write");

    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    const id = parseInt(params.id);
    if (isNaN(id)) {
      return NextResponse.json(
        { error: "유효하지 않은 ID입니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { error: deleteError } = await supabase
      .from("national_support_application")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("건강디딤돌 신청결과 삭제 오류:", deleteError);
      return NextResponse.json(
        { error: "건강디딤돌 신청결과를 삭제하는 중 오류가 발생했습니다.", details: deleteError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error: any) {
    console.error("건강디딤돌 신청결과 삭제 API 오류:", error);
    return NextResponse.json(
      { error: error.message || "건강디딤돌 신청결과를 삭제하는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
