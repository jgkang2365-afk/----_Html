import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth/session";

/**
 * 내 정보 수정 API
 * PATCH /api/users/me
 */
export async function PATCH(request: NextRequest) {
    try {
        const session = await getSession();

        if (!session) {
            return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
        }

        const body = await request.json();
        const { job, k2b_id, k2b_pw, survey_code } = body;

        const supabase = await createClient();

        // 내 정보 수정 (ID는 세션에서 가져옴)
        const { data: updatedUser, error: updateError } = await supabase
            .from("users")
            .update({
                ...(job && { job }),
                ...(k2b_id !== undefined && { k2b_id }),
                ...(k2b_pw !== undefined && { k2b_pw }),
                ...(survey_code !== undefined && { survey_code: survey_code || null }),
            })
            .eq("id", session.userId)
            .select("id, name, role, job, survey_code, k2b_id, updated_at")
            .single();

        if (updateError) {
            console.error("Profile update error:", updateError);
            return NextResponse.json(
                { error: "정보 수정에 실패했습니다." },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            user: updatedUser,
            message: "내 정보가 수정되었습니다.",
        });
    } catch (error) {
        console.error("Update me error:", error);
        return NextResponse.json(
            { error: "정보 수정 중 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
