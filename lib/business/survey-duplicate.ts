/**
 * legacy preliminary_survey 중복 방어 관련 공통 판정 helper.
 *
 * Supabase/PostgREST의 PostgrestError는 code/message/details/hint 필드를 노출하며
 * constraint 이름을 직접 담는 `constraint` 필드는 없다. 대신 PostgreSQL 오류 본문
 * (message/details)에 constraint 이름이 포함되므로, 이를 기준으로 판정한다.
 */

export const LEGACY_SURVEY_UNIQUE_CONSTRAINT =
  "uq_preliminary_survey_code_year_period_measurement_date";

interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}

function errorText(error: PostgrestErrorLike | unknown): string {
  if (!error || typeof error !== "object") return "";
  const e = error as PostgrestErrorLike;
  return [e.message, e.details].filter(Boolean).join(" ").toLowerCase();
}

/**
 * 해당 오류가 이번 legacy preliminary_survey UNIQUE constraint 충돌인지 판정한다.
 *
 * 조건:
 * 1. PostgreSQL error code가 23505(unique_violation)이고
 * 2. 오류 본문(message/details)에 이번 constraint 이름이 포함되어 있다.
 *
 * 다른 UNIQUE constraint 충돌(23505)이어도 constraint 이름이 다르면 false를 반환하므로
 * "같은 사업장·년도·주기·측정일" 중복 메시지로 오인하지 않는다.
 */
export function isLegacySurveyUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as PostgrestErrorLike;
  if (e.code !== "23505") return false;
  return errorText(error).includes(LEGACY_SURVEY_UNIQUE_CONSTRAINT.toLowerCase());
}
