/**
 * 지정한계_관할지청 상수 정의
 * 
 * 이 파일에서 지정한계_관할지청 목록을 중앙 관리합니다.
 * 목록이 변경되면 이 파일만 수정하면 됩니다.
 * 
 * 약칭으로 표시됩니다:
 * - "대전지방고용노동청 천안지청" → "천안"
 * - "대전지방고용노동청" → "대전"
 * - "중부지방고용노동청 평택지청" → "평택"
 * - "중부지방고용노동청 경기지청" → "경기"
 */

/**
 * 지정한계_관할지청 목록 (약칭)
 */
export const DESIGNATED_OFFICES = [
  "천안",
  "대전",
  "평택",
  "경기",
] as const;

/**
 * 지정한계_관할지청 타입
 */
export type DesignatedOffice = typeof DESIGNATED_OFFICES[number];

/**
 * 지정한계_관할지청 전체명 → 약칭 매핑
 */
export const DESIGNATED_OFFICE_FULL_NAME_TO_SHORT: Record<string, string> = {
  "대전지방고용노동청 천안지청": "천안",
  "대전지방고용노동청": "대전",
  "중부지방고용노동청 평택지청": "평택",
  "중부지방고용노동청 경기지청": "경기",
};

/**
 * 지정한계_관할지청 약칭 → 전체명 매핑
 */
export const DESIGNATED_OFFICE_SHORT_TO_FULL_NAME: Record<string, string> = {
  "천안": "대전지방고용노동청 천안지청",
  "대전": "대전지방고용노동청",
  "평택": "중부지방고용노동청 평택지청",
  "경기": "중부지방고용노동청 경기지청",
};

/**
 * 전체명을 약칭으로 변환
 */
export function toShortName(fullName: string): string {
  // 1. 매핑 테이블 우선 확인
  if (DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[fullName]) {
    return DESIGNATED_OFFICE_FULL_NAME_TO_SHORT[fullName];
  }

  if (!fullName) return "";

  // 2. "XX지청" 패턴 처리 (예: "대전지방고용노동청 청주지청" -> "청주")
  const jicheongMatch = fullName.match(/\s+(.+)지청$/);
  if (jicheongMatch && jicheongMatch[1]) {
    return jicheongMatch[1];
  }

  // 3. "XX지방고용노동청" 패턴 처리 (예: "대전지방고용노동청" -> "대전")
  const cheongMatch = fullName.match(/^(.+)지방고용노동청$/);
  if (cheongMatch && cheongMatch[1]) {
    return cheongMatch[1];
  }

  // 4. 원래 값 반환 (변환 불가 시)
  return fullName;
}

/**
 * 약칭을 전체명으로 변환
 */
export function toFullName(shortName: string): string {
  return DESIGNATED_OFFICE_SHORT_TO_FULL_NAME[shortName] || shortName;
}

/**
 * Select 컴포넌트용 옵션 배열 (전체 옵션 포함)
 */
export const DESIGNATED_OFFICE_OPTIONS = [
  { value: "", label: "전체" },
  ...DESIGNATED_OFFICES.map((office) => ({
    value: office,
    label: office,
  })),
];

/**
 * Select 컴포넌트용 옵션 배열 (전체 옵션 없음)
 */
export const DESIGNATED_OFFICE_OPTIONS_WITHOUT_ALL = DESIGNATED_OFFICES.map((office) => ({
  value: office,
  label: office,
}));

/**
 * 매출 집계용 지정한계_관할지청 목록 (기타 포함)
 */
export const DESIGNATED_OFFICES_FOR_SALES = [
  ...DESIGNATED_OFFICES,
  "기타",
] as const;

/**
 * 지정한계_관할지청별 공문연번 접두사 매핑 (약칭 기준)
 */
export const DOCUMENT_NUMBER_PREFIX_MAP: Record<string, string> = {
  "천안": "천",
  "대전": "대",
  "평택": "평",
  "경기": "경",
};

/**
 * 지정한계_관할지청별 공문연번 접두사 가져오기
 * @param designatedOffice 지정한계_관할지청 (약칭 또는 전체명 모두 지원)
 * @returns 접두사 (예: "천", "대", "평", "경")
 */
export function getDocumentNumberPrefix(designatedOffice: string): string {
  // 약칭으로 변환
  const shortName = toShortName(designatedOffice);

  // 약칭 기준으로 접두사 찾기
  if (DOCUMENT_NUMBER_PREFIX_MAP[shortName]) {
    return DOCUMENT_NUMBER_PREFIX_MAP[shortName];
  }

  // 하위 호환성: 전체명 직접 매칭
  if (designatedOffice.includes("천안지청") || shortName === "천안") {
    return "천";
  } else if (designatedOffice === "대전지방고용노동청" || shortName === "대전") {
    return "대";
  } else if (designatedOffice.includes("평택지청") || shortName === "평택") {
    return "평";
  } else if (designatedOffice.includes("경기지청") || shortName === "경기") {
    return "경";
  }

  // 기본값
  return "천";
}

/**
 * 지정한계_관할지청이 유효한지 확인
 * @param office 확인할 지정한계_관할지청
 * @returns 유효 여부
 */
export function isValidDesignatedOffice(office: string): boolean {
  return DESIGNATED_OFFICES.includes(office as DesignatedOffice);
}
