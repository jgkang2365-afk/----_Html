import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * 측정 대상 사업장 관리 상태 수정 API
 * PATCH /api/businesses/status
 */
export async function PATCH(request: NextRequest) {
    try {
        await checkPermission("journal:write");

        const body = await request.json();
        const { code, year, period, status } = body;

        if (!code || !year || !period) {
            return NextResponse.json(
                { error: "필수 파라미터가 누락되었습니다." },
                { status: 400 }
            );
        }

        const supabase = await createClient();

        // 상태 업데이트
        const { error } = await supabase
            .from("measurement_target_business")
            .update({ management_status: status })
            .eq("code", code)
            .eq("year", year)
            .eq("period", period);

        if (error) {
            console.error("사업장 관리 상태 업데이트 오류:", error);
            return NextResponse.json(
                { error: "상태 업데이트 중 오류가 발생했습니다." },
                { status: 500 }
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("사업장 관리 상태 업데이트 API 오류:", error);
        return NextResponse.json(
            { error: "서버 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
