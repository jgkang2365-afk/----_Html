import { SupabaseClient } from "@supabase/supabase-js";
import { getFirstMeasurer, getSurveyCode } from "@/lib/utils/survey-code";

export const MEASURER_OVERLAP_CONFIRMATION_CODE = "MEASURER_OVERLAP_CONFIRMATION_REQUIRED";
export const MEASURER_OVERLAP_LIMIT_CODE = "MEASURER_OVERLAP_LIMIT_EXCEEDED";

interface ResolveSurveyAssignmentOptions {
  supabase: SupabaseClient;
  measurementDate: string;
  measurer: string;
  surveyId?: number;
  currentSurveyCode?: string | null;
  confirmOverlap?: boolean;
}

export interface SurveyAssignmentResolution {
  primaryMeasurer: string;
  surveyCode: string;
  assignmentNumber: 1 | 2;
  conflicts: Array<{ id: number; businessName: string; surveyCode: string | null }>;
  requiresConfirmation: boolean;
}

async function getBaseSurveyCode(
  supabase: SupabaseClient,
  primaryMeasurer: string,
  measurementDate: string
): Promise<string> {
  const { data: user, error } = await supabase
    .from("users")
    .select("survey_code")
    .eq("name", primaryMeasurer)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`공시료 코드 조회에 실패했습니다: ${error.message}`);
  }

  const code = String(user?.survey_code || getSurveyCode(primaryMeasurer, measurementDate) || "")
    .trim()
    .toUpperCase();

  if (!code) {
    throw new Error(`${primaryMeasurer}님의 기본 공시료 코드를 찾을 수 없습니다.`);
  }

  return code;
}

export async function resolveSurveyAssignment({
  supabase,
  measurementDate,
  measurer,
  surveyId,
  currentSurveyCode,
  confirmOverlap = false,
}: ResolveSurveyAssignmentOptions): Promise<SurveyAssignmentResolution> {
  const primaryMeasurer = getFirstMeasurer(measurer);
  if (!primaryMeasurer) {
    throw new Error("첫 번째 측정자를 확인할 수 없습니다.");
  }

  const { data: sameDateSurveys, error } = await supabase
    .from("preliminary_survey")
    .select("id, business_name, measurer, survey_code, created_at")
    .eq("measurement_date", measurementDate)
    .not("measurer", "is", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new Error(`측정자 중복 확인에 실패했습니다: ${error.message}`);
  }

  const matchingAssignments = (sameDateSurveys || []).filter(
    (survey) => getFirstMeasurer(survey.measurer) === primaryMeasurer
  );
  const currentIndex = surveyId
    ? matchingAssignments.findIndex((survey) => survey.id === surveyId)
    : -1;
  const assignmentNumber = currentIndex >= 0 ? currentIndex + 1 : matchingAssignments.length + 1;

  if (assignmentNumber > 2 || (currentIndex >= 0 && matchingAssignments.length > 2)) {
    const limitError = new Error(
      `${primaryMeasurer}님은 ${measurementDate}에 이미 2개 업체가 배정되어 있어 추가 배정할 수 없습니다.`
    );
    limitError.name = MEASURER_OVERLAP_LIMIT_CODE;
    throw limitError;
  }

  const baseCode = await getBaseSurveyCode(supabase, primaryMeasurer, measurementDate);
  const resolvedCode = assignmentNumber === 2 ? `${baseCode}${baseCode}` : baseCode;
  const conflicts = matchingAssignments
    .filter((survey) => survey.id !== surveyId)
    .map((survey) => ({
      id: survey.id,
      businessName: survey.business_name || "사업장명 없음",
      surveyCode: survey.survey_code,
    }));

  const isExistingSecondAssignment =
    currentIndex === 1 &&
    String(currentSurveyCode || "")
      .trim()
      .toUpperCase() === resolvedCode;
  const requiresConfirmation =
    assignmentNumber === 2 && !confirmOverlap && !isExistingSecondAssignment;

  const duplicateCode = (sameDateSurveys || []).find(
    (survey) =>
      survey.id !== surveyId &&
      String(survey.survey_code || "")
        .trim()
        .toUpperCase() === resolvedCode
  );

  if (duplicateCode) {
    throw new Error(
      `공시료 코드 [${resolvedCode}]는 ${measurementDate}에 다른 업체(${duplicateCode.business_name})에서 사용 중입니다.`
    );
  }

  return {
    primaryMeasurer,
    surveyCode: resolvedCode,
    assignmentNumber: assignmentNumber as 1 | 2,
    conflicts,
    requiresConfirmation,
  };
}

export async function rebalanceSurveyCodesForDate(
  supabase: SupabaseClient,
  measurementDate: string,
  measurer: string
): Promise<void> {
  const primaryMeasurer = getFirstMeasurer(measurer);
  if (!primaryMeasurer) return;

  const { data: surveys, error } = await supabase
    .from("preliminary_survey")
    .select("id, measurer, survey_code, created_at")
    .eq("measurement_date", measurementDate)
    .not("measurer", "is", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    console.error("공시료 코드 재정렬 조회 오류:", error);
    return;
  }

  const matchingAssignments = (surveys || [])
    .filter((survey) => getFirstMeasurer(survey.measurer) === primaryMeasurer)
    .slice(0, 2);
  const baseCode = await getBaseSurveyCode(supabase, primaryMeasurer, measurementDate);

  for (let index = 0; index < matchingAssignments.length; index += 1) {
    const survey = matchingAssignments[index];
    const expectedCode = index === 0 ? baseCode : `${baseCode}${baseCode}`;
    if (
      String(survey.survey_code || "")
        .trim()
        .toUpperCase() !== expectedCode
    ) {
      const { error: updateError } = await supabase
        .from("preliminary_survey")
        .update({ survey_code: expectedCode })
        .eq("id", survey.id);

      if (updateError) {
        console.error("공시료 코드 재정렬 저장 오류:", updateError);
      }
    }
  }
}

/**
 * 활성화된 측정 담당자 수를 조회합니다.
 */
export async function getActiveMeasurerCount(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("job", "측정")
    .eq("is_active", true);

  if (error) {
    console.error("활성 측정 담당자 수 조회 오류:", error);
    // 데이터베이스 오류 발생 시 기본값으로 6을 반환합니다.
    return 6;
  }

  return count || 0;
}

/**
 * 예비조사 목록을 분석하여 실질적으로 차지하는 공시료 슬롯(팀) 수를 계산합니다.
 * 접미사가 붙거나 반복되는 코드(예: C, CC)는 동일한 1개의 슬롯으로 카운트합니다.
 */
export function calculateActualSlots(surveys: Array<{ survey_code?: string | null }>): number {
  const uniqueBaseCodes = new Set<string>();
  let nullOrEmptyCount = 0;

  for (const survey of surveys) {
    const code = survey.survey_code?.trim().toUpperCase();
    if (!code) {
      // 공시료 코드가 없는 경우 각각을 독립된 슬롯으로 취급합니다.
      nullOrEmptyCount++;
      continue;
    }

    // CC -> C, DD -> D 처럼 동일 문자가 반복되는 부분을 첫 번째 문자로 변환합니다.
    const baseCode = code.charAt(0);
    uniqueBaseCodes.add(baseCode);
  }

  return uniqueBaseCodes.size + nullOrEmptyCount;
}

