import { SupabaseClient } from "@supabase/supabase-js";
import { getKSTISOString } from "@/lib/utils/date-utils";

/**
 * 건강디딤돌 신청결과의 국고지원 상태값을 측정 대상 사업장 관리(measurement_business)에 동기화합니다.
 * - 신청결과 국고지원 상태가 "지원"이면 -> "대상"
 * - 신청결과 국고지원 상태가 "비대상"이거나 없으면 -> "비대상"
 *
 * @param supabase Supabase 클라이언트 인스턴스
 * @param code 사업장 코드
 * @param year 측정 년도
 * @param period 측정 주기
 * @param nationalSupportStatus 건강디딤돌 신청결과의 국고지원 상태 ("지원", "비대상" 등)
 */
export async function syncNationalSupportToBusiness(
    supabase: SupabaseClient,
    code: string,
    year: number,
    period: string,
    nationalSupportStatus: string | null,
    representativeName?: string | null,
    industrialAccidentNumber?: string | null,
    commencementNumber?: string | null
) {
    try {
        let targetStatus: "대상" | "비대상" | null = null;

        // [The Joo Rule] 정규화 규칙 적용
        if (nationalSupportStatus === "지원" || nationalSupportStatus === "대상" || nationalSupportStatus === "지원대상") {
            targetStatus = "대상";
        } else if (nationalSupportStatus === "비대상" || nationalSupportStatus === "미지원") {
            targetStatus = "비대상";
        }

        if (!targetStatus) {
            return {
                success: false,
                error: new Error("확정되지 않은 건강디딤돌 상태는 사업장 국고 상태로 동기화할 수 없습니다."),
            };
        }

        // 1. 기존 레코드 존재 여부 및 필수 마스터 필드 조회
        const { data: existing, error: fetchError } = await supabase
            .from("measurement_target_business")
            .select("id, business_name, representative_name, industrial_accident_number, commencement_number")
            .eq("code", code)
            .eq("year", year)
            .eq("period", period)
            .maybeSingle();

        if (fetchError) {
            console.error("측정대상사업장 조회 오류:", fetchError);
        }

        const hasExisting = !!existing;

        // 대표자명 결정 (기존 값이 있으면 보존, 없으면 엑셀/폼 값 사용)
        let finalRepName: string | null = null;
        if (hasExisting && existing.representative_name) {
            finalRepName = existing.representative_name;
        } else {
            finalRepName = representativeName || null;
        }

        // 산재관리번호 결정 (기존 값이 있으면 보존, 없으면 엑셀/폼 값 사용)
        let finalSanjae: string | null = null;
        if (hasExisting && existing.industrial_accident_number) {
            finalSanjae = existing.industrial_accident_number;
        } else {
            finalSanjae = industrialAccidentNumber || null;
        }

        // 사업개시번호 결정 (기존 값이 있으면 보존, 없으면 엑셀/폼 값 사용)
        let finalCommencement: string | null = null;
        if (hasExisting && existing.commencement_number) {
            finalCommencement = existing.commencement_number;
        } else {
            finalCommencement = commencementNumber || null;
        }

        if (!hasExisting) {
            // [대책 1] 레코드가 존재하지 않는 신규/임시 사업장의 경우 자동 생성(INSERT)
            const insertPayload = {
                code,
                year,
                period,
                business_name: "미등록 사업장 (건강디딤돌 연동)",
                representative_name: finalRepName,
                industrial_accident_number: finalSanjae,
                commencement_number: finalCommencement,
                national_support_status: targetStatus,
                is_registered: "미실시",
                created_at: getKSTISOString(),
                updated_at: getKSTISOString()
            };

            const { error: insertError } = await supabase
                .from("measurement_target_business")
                .insert(insertPayload);

            if (insertError) {
                console.error(
                    `측정사업장 자동 생성 실패 (code: ${code}, year: ${year}, period: ${period}):`,
                    insertError
                );
                return { success: false, error: insertError };
            }
        } else {
            // 레코드가 이미 존재하는 경우 UPDATE 동기화 진행
            const updatePayload: any = {
                national_support_status: targetStatus,
                updated_at: getKSTISOString(),
            };

            if (finalRepName) {
                updatePayload.representative_name = finalRepName;
            }
            if (finalSanjae) {
                updatePayload.industrial_accident_number = finalSanjae;
            }
            if (finalCommencement) {
                updatePayload.commencement_number = finalCommencement;
            }

            const { error: updateError } = await supabase
                .from("measurement_target_business")
                .update(updatePayload)
                .eq("code", code)
                .eq("year", year)
                .eq("period", period);

            if (updateError) {
                console.error(
                    `측정사업장 국고지원 상태 동기화 실패 (code: ${code}, year: ${year}, period: ${period}):`,
                    updateError
                );
                return { success: false, error: updateError };
            }
        }

        return { success: true };
    } catch (error) {
        console.error("측정사업장 국고지원 상태 동기화 중 예외 발생:", error);
        return { success: false, error };
    }
}

