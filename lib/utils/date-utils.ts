/**
 * 날짜 관련 유틸리티 함수
 */

/**
 * 날짜 문자열을 다양한 형식으로 파싱
 * @param dateStr - 날짜 문자열 (20260101, 0101, 2026-01-01 등)
 * @returns Date 객체 또는 null
 */
export function parseDateInput(dateStr: string): Date | null {
  if (!dateStr || !dateStr.trim()) return null;

  const cleaned = dateStr.trim().replace(/[^\d]/g, "");

  // 8자리 형식 (YYYYMMDD)
  if (cleaned.length === 8) {
    const year = parseInt(cleaned.substring(0, 4), 10);
    const month = parseInt(cleaned.substring(4, 6), 10) - 1; // 월은 0부터 시작
    const day = parseInt(cleaned.substring(6, 8), 10);
    const date = new Date(year, month, day);
    if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
      return date;
    }
  }

  // 4자리 형식 (MMDD) - 현재 년도 사용
  if (cleaned.length === 4) {
    const currentYear = new Date().getFullYear();
    const month = parseInt(cleaned.substring(0, 2), 10) - 1;
    const day = parseInt(cleaned.substring(2, 4), 10);
    const date = new Date(currentYear, month, day);
    if (date.getMonth() === month && date.getDate() === day) {
      return date;
    }
  }

  // 표준 형식 (YYYY-MM-DD)
  const standardDate = new Date(dateStr);
  if (!isNaN(standardDate.getTime())) {
    return standardDate;
  }

  return null;
}

/**
 * 날짜를 mm/dd 형식으로 변환
 * @param date - Date 객체 또는 날짜 문자열
 * @returns mm/dd 형식 문자열
 */
export function formatDateMMDD(date: Date | string | null | undefined): string {
  if (!date) return "";
  
  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return "";

  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  return `${month}/${day}`;
}

/**
 * 날짜를 YYYY-MM-DD 형식으로 변환 (데이터베이스 저장용)
 * @param date - Date 객체 또는 날짜 문자열
 * @returns YYYY-MM-DD 형식 문자열
 */
export function formatDateYYYYMMDD(date: Date | string | null | undefined): string {
  if (!date) return "";
  
  const dateObj = typeof date === "string" ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return "";

  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * 한국 공휴일 목록 (2025년 기준, 필요시 확장)
 */
const KOREAN_HOLIDAYS_2025 = [
  "2025-01-01", // 신정
  "2025-01-28", // 설날
  "2025-01-29", // 설날
  "2025-01-30", // 설날
  "2025-03-01", // 삼일절
  "2025-05-05", // 어린이날
  "2025-05-06", // 어린이날 대체공휴일
  "2025-06-06", // 현충일
  "2025-08-15", // 광복절
  "2025-10-03", // 개천절
  "2025-10-09", // 한글날
  "2025-12-25", // 크리스마스
];

/**
 * 날짜가 공휴일인지 확인
 * @param date - Date 객체
 * @returns 공휴일 여부
 */
export function isHoliday(date: Date): boolean {
  const dateStr = formatDateYYYYMMDD(date);
  return KOREAN_HOLIDAYS_2025.includes(dateStr);
}

/**
 * 날짜 범위의 측정요일 계산 (공휴일 제외)
 * @param startDate - 시작일
 * @param endDate - 종료일
 * @returns 요일 문자열 (예: "월, 화, 수")
 */
export function calculateMeasurementWeekdays(
  startDate: Date | string | null | undefined,
  endDate: Date | string | null | undefined
): string {
  if (!startDate || !endDate) return "";

  const start = typeof startDate === "string" ? new Date(startDate) : startDate;
  const end = typeof endDate === "string" ? new Date(endDate) : endDate;

  if (isNaN(start.getTime()) || isNaN(end.getTime())) return "";

  // 시작일이 종료일보다 늦으면 빈 문자열 반환
  if (start > end) return "";

  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  const weekdaySet = new Set<string>();

  const current = new Date(start);
  // 종료일까지 포함하여 계산
  const endDateObj = new Date(end);
  endDateObj.setHours(23, 59, 59, 999); // 종료일 끝까지 포함

  while (current <= endDateObj) {
    // 공휴일이 아니고 주말이 아닌 경우만 추가
    if (!isHoliday(current) && current.getDay() !== 0 && current.getDay() !== 6) {
      const weekday = weekdays[current.getDay()];
      weekdaySet.add(weekday);
    }
    current.setDate(current.getDate() + 1);
  }

  // 요일 순서대로 정렬
  const weekdayOrder = ["월", "화", "수", "목", "금"];
  const weekdayList = weekdayOrder.filter((day) => weekdaySet.has(day));

  return weekdayList.join(", ");
}
