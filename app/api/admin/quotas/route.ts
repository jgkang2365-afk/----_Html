import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

/**
 * 지청별 지정한계(인가 갯수) 관리 API
 * 
 * GET /api/admin/quotas
 * - 파라미터: year (없으면 현재 년도)
 * 
 * POST /api/admin/quotas
 * - body: { year, period, office_name, quota, change_reason }
 * - 이력 저장 기능 포함
 */
export async function GET(request: NextRequest) {
    try {
        // 관리자 권한 체크 (필요 시 수정)
        // await checkPermission("admin:read");

        const { searchParams } = new URL(request.url);
        const year = searchParams.get("year");

        const supabase = await createClient();

        let query = supabase
            .from("designated_office_quotas")
            .select("*");

        if (year) {
            query = query.eq("year", parseInt(year));
        }

        const { data, error } = await query
            .order("year", { ascending: false }) // 최신 년도 먼저
            .order("period", { ascending: true }) // 상반기 먼저
            .order("office_name", { ascending: true }); // 이름순

        if (error) {
            throw error;
        }

        return NextResponse.json({
            success: true,
            data: data || [],
        });
    } catch (error: any) {
        console.error("인과 갯수 조회 오류:", error);
        return NextResponse.json(
            { error: error.message || "데이터를 불러오는 중 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        // 관리자 권한 체크
        // await checkPermission("admin:write");

        const body = await request.json();
        const { year, period, office_name, quota, change_reason } = body;

        if (!year || !period || !office_name || quota === undefined) {
            return NextResponse.json(
                { error: "필수 정보가 누락되었습니다." },
                { status: 400 }
            );
        }

        const supabase = await createClient();

        // 1. 기존 데이터 조회 (이력 저장을 위해)
        const { data: existingData } = await supabase
            .from("designated_office_quotas")
            .select("id, quota")
            .match({ year, period, office_name })
            .single();

        // 변경 사항이 없으면 skip
        if (existingData && existingData.quota === quota) {
            return NextResponse.json({
                success: true,
                data: existingData,
                message: "변경 사항이 없습니다."
            });
        }

        // 2. 데이터 Upsert (이미 있으면 업데이트, 없으면 생성)
        const { data: newData, error: upsertError } = await supabase
            .from("designated_office_quotas")
            .upsert(
                { year, period, office_name, quota },
                { onConflict: "year, period, office_name" }
            )
            .select()
            .single();

        if (upsertError) {
            throw upsertError;
        }

        // 3. 이력 저장 (기존 데이터가 있었고, 값이 변경된 경우)
        if (existingData && newData) {
            const { error: historyError } = await supabase
                .from("designated_office_quota_history")
                .insert({
                    quota_id: newData.id,
                    previous_quota: existingData.quota,
                    new_quota: newData.quota,
                    change_reason: change_reason || "직접 수정",
                });

            if (historyError) {
                console.error("이력 저장 실패:", historyError);
                // 이력 저장 실패는 메인 로직 실패로 처리하지 않음 (Warn log only)
            }
        }

        return NextResponse.json({
            success: true,
            data: newData,
        });
    } catch (error: any) {
        console.error("인가 갯수 저장 오류:", error);
        return NextResponse.json(
            { error: error.message || "저장 중 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
