
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { ensureBusinessCoordinate } from "@/lib/business-coordinates/service";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { year, period, code, business_name, ...otherFields } = body;

        // 권한 확인 - measurement_business 테이블에 쓰기 권한은 journal:write와 유사하게 취급
        // 혹은 별도 권한이 필요할 수 있으나 일단 journal:write로 체크
        await checkPermission("journal:write");

        if (!year || !period) {
            return NextResponse.json(
                { error: "년도와 주기는 필수입니다." },
                { status: 400 }
            );
        }

        const supabase = await createClient();

        // 코드 체크
        if (!code) {
            return NextResponse.json(
                { error: "사업장 코드는 필수입니다." },
                { status: 400 }
            );
        }
        const finalCode = code;

        // 사업장명 기본값
        const finalBusinessName = business_name || "미지정 사업장";

        // 데이터 삽입
        const { data: insertedData, error } = await supabase
            .from("measurement_target_business")
            .insert({
                code: finalCode,
                year,
                period,
                business_name: finalBusinessName,
                plan_manager: otherFields.plan_manager || null, // 담당자
                address: otherFields.address || null,
                manager_name: otherFields.manager_name || null,
                manager_mobile: otherFields.manager_mobile || null,
                notes: otherFields.notes || null,
                business_category: otherFields.business_category || null,
                future_measurement_date: otherFields.future_measurement_date || null,
                measurement_date: otherFields.measurement_date || null,
                // 필수 필드 (NOT NULL) 값 설정
                plan_based_year: year - 1, // 기본적으로 이전 년도 기준
                plan_based_period: period, // 동일 반기 기준
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .select()
            .single();

        if (error) {
            // 중복 코드 에러 처리
            if (error.code === '23505') {
                return NextResponse.json(
                    { error: "이미 존재하는 사업장 코드입니다. 다른 코드를 사용해주세요." },
                    { status: 409 }
                );
            }
            console.error("사업장 추가 오류:", error);
            return NextResponse.json(
                { error: "사업장 추가 중 오류가 발생했습니다." },
                { status: 500 }
            );
        }

        let geocodeResult = null;
        try {
            geocodeResult = await ensureBusinessCoordinate(supabase, {
                code: finalCode,
                businessName: finalBusinessName,
                fallbackAddress: otherFields.address,
            });
        } catch (coordinateError) {
            console.error("[BusinessCoordinates] 간편 등록 후 좌표 처리 실패:", coordinateError instanceof Error ? coordinateError.message : "unknown");
        }

        return NextResponse.json({
            success: true,
            businessCreated: true,
            business: insertedData,
            geocodeStatus: geocodeResult?.geocoding_status?.toLowerCase() || "failed",
            latitude: geocodeResult?.latitude ?? null,
            longitude: geocodeResult?.longitude ?? null,
            geocodeMessage: geocodeResult?.geocoding_error || undefined,
        });

    } catch (error) {
        console.error("API 오류:", error);
        return NextResponse.json(
            { error: "서버 내부 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
