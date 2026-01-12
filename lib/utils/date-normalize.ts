/**
 * 날짜 값을 YYYY-MM-DD 형식으로 정규화하는 유틸리티 함수
 * HTML5 date input 필드에 사용하기 위한 함수
 */

/**
 * 날짜 값을 YYYY-MM-DD 형식으로 정규화
 * @param dateValue - 날짜 값 (다양한 형식 가능)
 * @returns YYYY-MM-DD 형식 문자열 또는 빈 문자열
 */
export function normalizeDateForInput(dateValue: string | null | undefined): string {
  if (!dateValue) return "";
  
  // 문자열이 아닌 경우 문자열로 변환
  let strValue = String(dateValue).trim();
  if (!strValue) return "";

  // 한글 문자 제거 ("일", "월", "년" 등)
  strValue = strValue.replace(/[일월년]/g, "").trim();
  
  // 이미 YYYY-MM-DD 형식인 경우 (정확한 형식 체크)
  const yyyyMMddMatch = strValue.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (yyyyMMddMatch) {
    const year = yyyyMMddMatch[1];
    const month = yyyyMMddMatch[2].padStart(2, "0");
    const day = yyyyMMddMatch[3].padStart(2, "0");
    const normalized = `${year}-${month}-${day}`;
    
    // 유효한 날짜인지 확인 (시간대 문제 방지를 위해 T00:00:00 추가)
    const date = new Date(normalized + "T00:00:00");
    if (!isNaN(date.getTime())) {
      const checkYear = date.getFullYear();
      const checkMonth = String(date.getMonth() + 1).padStart(2, "0");
      const checkDay = String(date.getDate()).padStart(2, "0");
      if (`${checkYear}-${checkMonth}-${checkDay}` === normalized) {
        return normalized;
      }
    }
  }

  // YYYYMMDD 형식 (8자리 숫자만) - 숫자만 추출
  const numbersOnly = strValue.replace(/[^\d]/g, "");
  if (numbersOnly.length === 8) {
    const year = numbersOnly.substring(0, 4);
    const month = numbersOnly.substring(4, 6);
    const day = numbersOnly.substring(6, 8);
    const normalized = `${year}-${month}-${day}`;
    
    // 유효한 날짜인지 확인 (시간대 문제 방지를 위해 T00:00:00 추가)
    const date = new Date(normalized + "T00:00:00");
    if (!isNaN(date.getTime())) {
      const checkYear = date.getFullYear();
      const checkMonth = String(date.getMonth() + 1).padStart(2, "0");
      const checkDay = String(date.getDate()).padStart(2, "0");
      if (`${checkYear}-${checkMonth}-${checkDay}` === normalized) {
        return normalized;
      }
    }
  }

  // Date 객체로 파싱 시도 (마지막 수단)
  const date = new Date(strValue);
  if (!isNaN(date.getTime())) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const normalized = `${year}-${month}-${day}`;
    
    // 유효한 날짜인지 확인
    const checkDate = new Date(normalized + "T00:00:00");
    if (!isNaN(checkDate.getTime())) {
      const checkYear = checkDate.getFullYear();
      const checkMonth = String(checkDate.getMonth() + 1).padStart(2, "0");
      const checkDay = String(checkDate.getDate()).padStart(2, "0");
      if (`${checkYear}-${checkMonth}-${checkDay}` === normalized) {
        return normalized;
      }
    }
  }

  // 파싱 실패 시 빈 문자열 반환 (잘못된 값 방지)
  return "";
}
