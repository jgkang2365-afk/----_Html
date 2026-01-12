/**
 * 데이터 검증 및 정규화 유틸리티 함수
 */

/**
 * 주소 문자열을 검증하고 정규화합니다.
 * @param address 주소 문자열
 * @returns 정규화된 주소 또는 null (빈 문자열, 공백만 있는 경우 null)
 */
export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = String(address).trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * 지정지청 값을 검증합니다.
 * @param office 지정지청 값
 * @returns 유효한 지정지청 또는 null
 */
export function validateDesignatedOffice(office: string | null | undefined): string | null {
  if (!office) return null;
  const normalized = String(office).trim();
  const validOffices = ["천안", "대전", "평택", "경기"];
  return validOffices.includes(normalized) ? normalized : null;
}

/**
 * 문자열 값을 정규화합니다 (빈 문자열, 공백만 있는 경우 null 반환)
 */
export function normalizeString(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}
