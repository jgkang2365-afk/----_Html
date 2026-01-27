/**
 * 사업자등록번호 포맷팅 유틸리티
 * 형식: XXX-XX-XXXXX (3-2-5)
 */

/**
 * 사업자등록번호를 XXX-XX-XXXXX 형식으로 포맷팅
 * @param value - 사업자등록번호 (하이픈 포함/미포함 모두 가능)
 * @returns 포맷팅된 사업자등록번호 (XXX-XX-XXXXX)
 */
export function formatBusinessNumber(value: string | null | undefined): string {
  if (!value) return "";

  // 숫자만 추출
  const numbers = String(value).replace(/[^\d]/g, "");

  // 최대 10자리까지만
  const limited = numbers.slice(0, 10);

  if (!limited) return "";

  // 하이픈 추가 (XXX-XX-XXXXX 형식)
  if (limited.length <= 3) {
    return limited;
  } else if (limited.length <= 5) {
    return `${limited.slice(0, 3)}-${limited.slice(3)}`;
  } else {
    return `${limited.slice(0, 3)}-${limited.slice(3, 5)}-${limited.slice(5)}`;
  }
}

/**
 * 사업자등록번호를 또는 산재관리번호 등을 자릿수에 맞게 검증
 * @param value - 번호 문자열
 * @param expectedLength - 기대하는 숫자 자릿수 (10 또는 11)
 * @returns 유효성 검사 결과 (비어있으면 유효한 것으로 간주)
 */
export function isValidDigitCount(value: string | null | undefined, expectedLength: number): boolean {
  if (!value) return true;
  const numbers = String(value).replace(/[^\d]/g, "");
  if (numbers === "") return true;
  return numbers.length === expectedLength;
}

/**
 * 번호에서 숫자만 추출하여 반환
 * @param value - 번호 문자열
 * @returns 숫자만 남은 문자열 (없으면 null)
 */
export function cleanToDigits(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = String(value).replace(/[^\d]/g, "");
  return cleaned === "" ? null : cleaned;
}

/**
 * 사업자등록번호를 숫자만 추출 (하이픈 제거) - 레거시 지원
 * @param value - 사업자등록번호
 * @returns 숫자만 포함된 사업자등록번호
 */
export function parseBusinessNumber(value: string | null | undefined): string {
  if (!value) return "";
  return String(value).replace(/[^\d]/g, "");
}
