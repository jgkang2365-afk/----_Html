export const DESIGNATED_MEASUREMENT_INSTITUTION_REPORT_NAME =
  "작업환경측정기관 선정 신고서";

export const EXCLUDED_SELECTION_REPORT_JURISDICTIONS = [
  "경기",
  "평택",
  "대전",
  "천안",
] as const;

export function isDocumentDefinitionVisibleForJurisdiction(
  documentName: unknown,
  officeJurisdiction: unknown
): boolean {
  if (documentName !== DESIGNATED_MEASUREMENT_INSTITUTION_REPORT_NAME) return true;

  const jurisdiction = String(officeJurisdiction ?? "").trim();
  return !EXCLUDED_SELECTION_REPORT_JURISDICTIONS.includes(
    jurisdiction as (typeof EXCLUDED_SELECTION_REPORT_JURISDICTIONS)[number]
  );
}
