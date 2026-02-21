import { SupabaseClient } from "@supabase/supabase-js";

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
    nationalSupportStatus: string | null
) {
    try {
        let targetStatus: "대상" | "비대상" = "비대상";

        if (nationalSupportStatus === "지원") {
            targetStatus = "대상";
        }

        // measurement_business 업데이트
        const { error: updateError } = await supabase
            .from("measurement_business")
            .update({
                national_support_status: targetStatus,
                updated_at: new Date().toISOString(),
            })
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

        return { success: true };
    } catch (error) {
        console.error("측정사업장 국고지원 상태 동기화 중 예외 발생:", error);
        return { success: false, error };
    }
}
