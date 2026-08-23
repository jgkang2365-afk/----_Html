export const HWPX_PLACEHOLDER_ALIASES: Readonly<Record<string, string>> = {
  사업장명: "business_name",
  대표자: "representative_name",
  대표자명: "representative_name",
  주소: "address",
  업종: "business_category",
  전화번호: "phone",
  전화: "phone",
  주요생산품: "main_product",
  "주요 생산품": "main_product",
  팩스: "fax",
  팩스번호: "fax",
  "총 근로자수": "total_employees",
  "총 근로자 수": "total_employees",
  담당자명: "manager_name",
  "담당자 메일": "manager_email",
  "담당자 이메일": "manager_email",
  "담당자 연락처": "manager_contact",
  사업자등록번호: "business_number",
  사업자번호: "business_number",
  산재관리번호: "industrial_accident_number",
  산재번호: "industrial_accident_number",
  예비조사자: "preliminary_surveyor",
  측정연도: "measurement_year",
  측정년도: "measurement_year",
  측정주기: "measurement_period",
} as const;

export function normalizeHwpxPlaceholderLabel(value: unknown): string {
  return String(value ?? "")
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ");
}

export function resolveHwpxPlaceholderAlias(value: unknown): string | null {
  const normalized = normalizeHwpxPlaceholderLabel(value);
  return normalized ? HWPX_PLACEHOLDER_ALIASES[normalized] || null : null;
}
