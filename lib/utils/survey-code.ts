/**
 * 공시료 코드 관련 유틸리티 함수
 */

/**
 * 측정자별 공시료 코드 매핑
 */
const MEASURER_CODE_MAP: Record<string, string> = {
  이태환: "A",
  한기문: "B",
  강종구: "C",
  이주형: "D",
  배윤민: "E",
  고유빈: "F",
};

/**
 * 측정자 목록
 */
export const MEASURER_LIST = Object.keys(MEASURER_CODE_MAP);

/**
 * 측정자 문자열에서 첫 번째 측정자를 추출
 * @param measurers - 측정자 문자열 (콤마 구분 또는 단일)
 * @returns 첫 번째 측정자 이름
 */
export function getFirstMeasurer(measurers: string | null | undefined): string | null {
  if (!measurers || !measurers.trim()) return null;
  
  // 콤마로 구분된 경우 첫 번째 추출
  const first = measurers.split(",")[0].trim();
  return first || null;
}

/**
 * 측정자에 따른 공시료 코드 부여
 * @param measurers - 측정자 문자열 (콤마 구분 또는 단일)
 * @returns 공시료 코드 (A-F)
 */
export function getSurveyCode(measurers: string | null | undefined): string | null {
  const firstMeasurer = getFirstMeasurer(measurers);
  if (!firstMeasurer) return null;

  return MEASURER_CODE_MAP[firstMeasurer] || null;
}
