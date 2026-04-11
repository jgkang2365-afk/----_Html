import { SupabaseClient } from "@supabase/supabase-js";

/**
 * 예비조사 순번 재정렬 함수
 * 모든 예비조사 데이터를 측정일(measurement_date) 오름차순, 생성일(created_at) 오름차순으로 정렬하여
 * 순번(sequence_number)을 1부터 순차적으로 재부여합니다.
 *
 * @param supabase Supabase 클라이언트 인스턴스
 */
export async function reassignSequenceNumbers(supabase: SupabaseClient) {
    try {
        // 1. 모든 예비조사 데이터 조회 (정렬 기준: 측정일 ASC, 공시료 코드 ASC, 생성일 ASC)
        const { data: surveys, error: fetchError } = await supabase
            .from("preliminary_survey")
            .select("id, measurement_date, survey_code, sequence_number")
            .order("measurement_date", { ascending: true, nullsFirst: false })
            .order("survey_code", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: true });

        if (fetchError) {
            console.error("순번 재정렬을 위한 데이터 조회 실패:", fetchError);
            throw fetchError;
        }

        if (!surveys || surveys.length === 0) {
            return;
        }

        // 2. 순번 업데이트가 필요한 항목 확인 및 업데이트
        let updateCount = 0;

        // 일괄 업데이트를 위한 배열 대신, 안전하게 하나씩 확인하며 업데이트
        // (대량 데이터가 아니므로 루프 처리해도 무방함. 향후 성능 이슈 시 RPC 등으로 변경 고려)
        for (let i = 0; i < surveys.length; i++) {
            const survey = surveys[i];
            const newSequence = i + 1;

            // 현재 순번과 새 순번이 다른 경우에만 업데이트
            if (survey.sequence_number !== newSequence) {
                const { error: updateError } = await supabase
                    .from("preliminary_survey")
                    .update({ sequence_number: newSequence })
                    .eq("id", survey.id);

                if (updateError) {
                    console.error(`순번 업데이트 실패 (id: ${survey.id}):`, updateError);
                } else {
                    updateCount++;
                }
            }
        }

        console.log(`순번 재정렬 완료. 총 ${surveys.length}건 중 ${updateCount}건 업데이트됨.`);
    } catch (error) {
        console.error("순번 재정렬 중 오류 발생:", error);
        throw error;
    }
}
