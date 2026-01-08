import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

export async function GET() {
  try {
    // 권한 체크
    await checkPermission("journal:read");

    const supabase = await createClient();

    // measurement_journal 테이블 데이터 개수 확인
    const { count: journalCount, error: journalError } = await supabase
      .from("measurement_journal")
      .select("*", { count: "exact", head: true });

    // measurement_business 테이블 데이터 개수 확인
    const { count: businessCount, error: businessError } = await supabase
      .from("measurement_business")
      .select("*", { count: "exact", head: true });

    // business_info 테이블 데이터 개수 확인
    const { count: infoCount, error: infoError } = await supabase
      .from("business_info")
      .select("*", { count: "exact", head: true });

    if (journalError || businessError || infoError) {
      return NextResponse.json(
        {
          error: "데이터 조회 중 오류가 발생했습니다.",
          details: {
            journalError: journalError?.message,
            businessError: businessError?.message,
            infoError: infoError?.message,
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      measurement_journal: journalCount || 0,
      measurement_business: businessCount || 0,
      business_info: infoCount || 0,
    });
  } catch (error) {
    console.error("데이터 확인 API 오류:", error);

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
        error: "데이터 확인 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

