/**
 * HTML5 date input용 날짜 검증 및 정규화 유틸리티
 * 브라우저 호환성을 고려한 엄격한 검증
 */

/**
 * 값이 YYYY-MM-DD 형식인지 검증
 */
export function isValidDateString(value: string | null | undefined): boolean {
  if (!value || typeof value !== "string") return false;
  
  // 정확한 YYYY-MM-DD 형식인지 확인
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(value)) return false;
  
  // 유효한 날짜인지 확인
  const date = new Date(value + "T00:00:00");
  if (isNaN(date.getTime())) return false;
  
  // 입력된 값과 파싱된 값이 일치하는지 확인
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const normalized = `${year}-${month}-${day}`;
  
  return normalized === value;
}

/**
 * HTML5 date input에 사용할 수 있는 값으로 정규화
 * 올바른 형식이 아니면 빈 문자열 반환
 */
export function normalizeForDateInput(value: string | null | undefined): string {
  if (!value) return "";
  
  const str = String(value).trim();
  if (!str) return "";
  
  // 이미 올바른 형식인지 확인
  if (isValidDateString(str)) {
    return str;
  }
  
  // 한글 문자 제거 후 재시도
  const cleaned = str.replace(/[일월년]/g, "").trim();
  if (cleaned && isValidDateString(cleaned)) {
    return cleaned;
  }
  
  // YYYYMMDD 형식 변환 시도
  const numbersOnly = cleaned.replace(/[^\d]/g, "");
  if (numbersOnly.length === 8) {
    const normalized = `${numbersOnly.substring(0, 4)}-${numbersOnly.substring(4, 6)}-${numbersOnly.substring(6, 8)}`;
    if (isValidDateString(normalized)) {
      return normalized;
    }
  }
  
  // 모든 변환 실패 시 빈 문자열 반환
  return "";
}
