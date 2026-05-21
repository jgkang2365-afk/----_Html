import { SupabaseClient } from "@supabase/supabase-js";

/**
 * [The Joo Rule] 데이터 전수 재계산 (Full Re-calculation)
 * 예비조사 일정에 변화가 생기면 해당 사업장의 모든 예비조사 레코드를 다시 조회하여 
 * 처음부터 끝까지 다시 그려 사업장 목록과 동기화합니다.
 */
export async function syncBusinessSchedule(
  supabase: SupabaseClient,
  code: string,
  year: number,
  period: string
) {
  if (!code) return;

  // 1. 해당 프로젝트(코드/년도/주기)의 모든 예비조사 데이터 재조회
  const { data: allSurveys, error: fetchError } = await supabase
    .from("preliminary_survey")
    .select("measurement_date, measurer")
    .eq("code", code)
    .eq("year", year)
    .eq("period", period)
    .not("measurement_date", "is", null)
    .order("measurement_date", { ascending: true });

  if (fetchError) {
    console.error(`[Full Re-Sync] Fetch error for ${code}:`, fetchError);
    return;
  }

  // 2. 통합 데이터 계산 (전체 재계산)
  let minDate: string | null = null;
  let maxDate: string | null = null;
  let unifiedCollaborators: string | null = null;
  let statusUpdate: string | null = null;

  if (allSurveys && allSurveys.length > 0) {
    // 시작일(min)과 종료일(max) 추출
    minDate = allSurveys[0].measurement_date;
    maxDate = allSurveys[allSurveys.length - 1].measurement_date;

    // 측정자(협력자) 합집합 추출 및 중복 제거
    const collaboratorSet = new Set<string>();
    allSurveys.forEach((s) => {
      if (s.measurer) {
        s.measurer.split(",").forEach((m: string) => {
          const trimmed = m.trim();
          if (trimmed) collaboratorSet.add(trimmed);
        });
      }
    });
    
    // 명단 정렬하여 문자열화
    unifiedCollaborators = Array.from(collaboratorSet).sort().join(", ");
    
    // 일정이 존재하므로 상태는 유지 (PATCH 등에서 별도 처리될 수 있음)
  } else {
    // [The Joo Rule] Successful Null: 남은 일정이 없으면 모든 칸을 null로 만드는 '초기화' 수행
    minDate = null;
    maxDate = null;
    unifiedCollaborators = null;
    statusUpdate = "미실시";
    
    console.log(`[Full Re-Sync] No surveys remain for ${code}. Resetting all fields to null.`);
  }

  // 3. measurement_target_business 테이블 동기화 (이중 잠금 방지용 데이터 주입)
  const businessUpdate: any = {
    measurement_date: minDate,
    measurement_end_date: maxDate,
    collaborators: unifiedCollaborators
  };
  
  if (statusUpdate) {
    businessUpdate.is_registered = statusUpdate;
  }

  const { error: bError } = await supabase
    .from("measurement_target_business")
    .update(businessUpdate)
    .eq("code", code)
    .eq("year", year)
    .eq("period", period);

  if (bError) {
    console.error(`[Full Re-Sync] Business update error for ${code}:`, bError);
  }

  // 4. measurement_journal 테이블 동기화 (측정자 명단 일치)
  // 주기를 유연하게 매칭하기 위해 (수시) 등 문자열 처리
  const cleanPeriod = period.replace("(수시)", "").replace("수시(", "").replace(")", "");
  const { error: jError } = await supabase
    .from("measurement_journal")
    .update({ measurer: unifiedCollaborators })
    .eq("code", code)
    .eq("measurement_year", year)
    .ilike("measurement_period", `%${cleanPeriod}%`);

  if (jError) {
    // 저널이 아직 생성 안 된 경우 경고만 남김
    console.warn(`[Full Re-Sync] Journal sync info for ${code}:`, jError.message);
  }

  console.log(`[Full Re-Sync] Done for ${code}. Items: ${allSurveys?.length || 0}, EndDate: ${maxDate || 'NULL'}`);
}
