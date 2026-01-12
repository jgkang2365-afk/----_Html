import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * 건강디딤돌 신청결과 조회 API
 * GET /api/businesses/national-support
 */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const period = searchParams.get("period");
    const code = searchParams.get("code");

    const supabase = await createClient();

    let query = supabase.from("national_support_application").select("*").order("code", { ascending: true });

    if (year) {
      query = query.eq("year", parseInt(year));
    }

    if (period) {
      query = query.eq("period", period);
    }

    if (code) {
      query = query.ilike("code", `%${code}%`);
    }

    const { data: entries, error } = await query;

    if (error) {
      console.error("건강디딤돌 신청결과 조회 오류:", error);
      return NextResponse.json(
        { error: "건강디딤돌 신청결과 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      entries: entries || [],
    });
  } catch (error) {
    console.error("건강디딤돌 신청결과 조회 API 오류:", error);

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
        error: "건강디딤돌 신청결과 조회 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
