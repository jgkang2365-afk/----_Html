const BUSINESS_INFO_OFFICE_JURISDICTION_CANONICAL_VALUES: Readonly<
  Record<string, string>
> = {
  "중부지방고용노동청 경기지청": "경기",
  "중부지방고용노동청 평택지청": "평택",
  "대전지방고용노동청": "대전",
  "대전지방고용노동청 천안지청": "천안",
};

/**
 * 사업장정보 엑셀의 관할청 전체명 중 문서 선택 규칙에 사용하는 네 값만 약칭으로 저장한다.
 * 그 외 관할청은 앞뒤 공백만 제거하고 원문을 보존한다.
 */
export function canonicalizeBusinessInfoOfficeJurisdiction(value: unknown): string {
  const trimmedValue = String(value ?? "").trim();
  return (
    BUSINESS_INFO_OFFICE_JURISDICTION_CANONICAL_VALUES[trimmedValue] ??
    trimmedValue
  );
}
