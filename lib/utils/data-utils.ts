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

/**
 * 대표자명 문자열을 정규화합니다.
 * - 세금 계산서 등 법적 데이터 유지를 위해 원본은 보존되나, 실시간 조회 시 가공용으로 쓰입니다.
 * - 쉼표(,)가 있을 경우 첫 번째 이름만 추출합니다.
 * - '외 [숫자][명/인]' 또는 '외'와 같은 불필요한 패턴을 제거합니다.
 * @param name 대표자명 문자열
 * @returns 정규화된 대표자명 또는 null
 */
export function normalizeRepresentativeName(name: string | null | undefined): string | null {
  if (!name) return null;
  let cleanName = String(name).trim();
  
  // 1. 쉼표(,)가 있을 경우 첫 번째 이름 추출
  if (cleanName.includes(",")) {
    cleanName = cleanName.split(",")[0].trim();
  }

  // 2. 슬래시(/)가 있을 경우 첫 번째 이름 추출
  if (cleanName.includes("/")) {
    cleanName = cleanName.split("/")[0].trim();
  }
  
  // 3. '외 [숫자][명/인]' 패턴 제거 (예: '홍길동외 1명', '이순신 외 2인', '한라산 외 1명')
  cleanName = cleanName.replace(/외\s*\d*\s*(명|인)/g, "").trim();
  
  // 4. '외' 단독 패턴 제거 (예: '홍길동 외')
  cleanName = cleanName.replace(/외$/g, "").trim();
  
  return cleanName.length > 0 ? cleanName : null;
}

const CONTACT_TITLES = [
  "대표이사", "관리소장", "공장장", "부사장", "본부장", "센터장",
  "팀장", "실장", "소장", "전무", "상무", "대표", "사장", "이사",
  "부장", "차장", "과장", "대리", "주임", "반장", "담당자",
];

/** 건강디딤돌 신청 작업에 전달할 담당자 이름에서 직책만 제거합니다. */
export function normalizeContactName(name: string | null | undefined): string | null {
  if (!name) return null;

  const titleAlternation = CONTACT_TITLES.join("|");
  let cleanName = String(name).trim().split(/[,/]/)[0].trim();
  cleanName = cleanName.replace(new RegExp(`\\((?:${titleAlternation})(?:님)?\\)`, "g"), " ");
  cleanName = cleanName.replace(new RegExp(`(^|\\s)(?:${titleAlternation})(?:님)?(?=\\s|$)`, "g"), " ");
  cleanName = cleanName.replace(new RegExp(`(?:${titleAlternation})(?:님)?$`), "");
  cleanName = cleanName.replace(/\s+/g, " ").trim();

  return cleanName || null;
}

