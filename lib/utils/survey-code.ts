/**
 * 공시료 코드 관련 유틸리티 함수
 */

/**
 * 측정자별 공시료 코드 매핑
 */
/**
 * 측정자별 공시료 코드 매핑을 측정일 기준으로 동적 반환
 * @param dateStr - 측정일 (YYYY-MM-DD)
 */
export function getMeasurerCodeMap(dateStr?: string | null): Record<string, string> {
  // 2026-06-09 당일부터 김민영 주임 적용 (그 이전에는 배윤민 대리 적용)
  if (dateStr && dateStr < "2026-06-09") {
    return {
      이태환: "A",
      한기문: "B",
      강종구: "C",
      이주형: "D",
      배윤민: "E", // 이주형과 고유빈 사이에 위치
      고유빈: "F",
    };
  } else {
    return {
      이태환: "A",
      한기문: "B",
      강종구: "C",
      이주형: "D",
      김민영: "G", // 김민영 주임이 배윤민 대리 자리에 위치
      고유빈: "F",
    };
  }
}

/**
 * 특정 측정일 기준 측정자 목록 반환
 * @param dateStr - 측정일 (YYYY-MM-DD)
 */
export function getMeasurerList(dateStr?: string | null): string[] {
  return Object.keys(getMeasurerCodeMap(dateStr));
}

/**
 * 측정자 목록 (기존 코드 하위 호환성 유지용)
 */
export const MEASURER_LIST = ["이태환", "한기문", "강종구", "이주형", "김민영", "고유빈"];

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
 * @param dateStr - 측정일 (YYYY-MM-DD)
 * @returns 공시료 코드 (A-G)
 */
export function getSurveyCode(measurers: string | null | undefined, dateStr?: string | null): string | null {
  const firstMeasurer = getFirstMeasurer(measurers);
  if (!firstMeasurer) return null;

  const map = getMeasurerCodeMap(dateStr);
  return map[firstMeasurer] || null;
}
