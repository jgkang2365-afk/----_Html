export const DOCUMENT_TYPES = [
  "GENERAL_PRELIMINARY_SURVEY",
  "FIELD_PRELIMINARY_SURVEY",
  "MEASUREMENT_PLAN_XLSM",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type StandardMeasurementPeriod = "상반기" | "하반기";
export const ANNUAL_TEMPLATE_PERIOD = "annual" as const;
export type TemplateMeasurementPeriod = StandardMeasurementPeriod | typeof ANNUAL_TEMPLATE_PERIOD;

export const DOCUMENT_TYPE_META: Record<
  DocumentType,
  { label: string; extension: ".hwpx" | ".xlsm" }
> = {
  GENERAL_PRELIMINARY_SURVEY: { label: "일반 예비조사표", extension: ".hwpx" },
  FIELD_PRELIMINARY_SURVEY: { label: "현장 예비조사표", extension: ".hwpx" },
  MEASUREMENT_PLAN_XLSM: { label: "화학물질입력 및 측정계획", extension: ".xlsm" },
};

export const GENERAL_HWPX_FIELDS = [
  "measurement_year",
  "measurement_period",
  "business_name",
  "representative_name",
  "address",
  "business_category",
  "phone",
  "main_product",
  "fax",
  "total_employees",
  "manager_name",
  "manager_email",
  "manager_contact",
  "preliminary_surveyor",
  "business_number",
  "industrial_accident_number",
] as const;

export const FIELD_HWPX_FIELDS = [
  "measurement_year",
  "measurement_period",
  "business_name",
  "representative_name",
  "address",
  "business_category",
  "phone",
  "main_product",
  "fax",
  "total_employees",
  "manager_name",
  "manager_email",
  "manager_contact",
] as const;

export const XLSM_TARGET_CELLS = {
  B1: "business_year_period_label",
  G1: "manager_name",
  C2: "manager_email",
  F2: "manager_contact",
  I2: "invoice_email",
} as const;

export function normalizeText(value: unknown): string {
  return String(value ?? "").trim();
}

export function normalizeMeasurementPeriod(value: unknown): StandardMeasurementPeriod | null {
  const normalized = normalizeText(value);
  if (["상반기", "1", "상"].includes(normalized)) return "상반기";
  if (["하반기", "2", "하"].includes(normalized)) return "하반기";
  return null;
}

export function parseTemplateMeasurementPeriod(value: unknown): TemplateMeasurementPeriod | null {
  const normalized = normalizeText(value);
  if (normalized === "상반기" || normalized === "하반기" || normalized === ANNUAL_TEMPLATE_PERIOD)
    return normalized;
  return null;
}

export function templateMeasurementPeriodLabel(value: unknown): string {
  return value === ANNUAL_TEMPLATE_PERIOD ? "연간 공통" : normalizeText(value);
}

export function templateMeasurementPeriodStorageSegment(period: TemplateMeasurementPeriod): string {
  if (period === ANNUAL_TEMPLATE_PERIOD) return "annual";
  return period === "상반기" ? "first-half" : "second-half";
}

export function formatBusinessNumber(value: unknown): string {
  const original = normalizeText(value);
  const digits = original.replace(/\D/g, "");
  return digits.length === 10
    ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
    : original;
}

export function buildManagerContact(managerMobile: unknown, managerPhone: unknown): string {
  return normalizeText(managerMobile) || normalizeText(managerPhone);
}

export function buildBusinessYearPeriodLabel(
  businessName: unknown,
  measurementYear: unknown,
  measurementPeriod: unknown
): string {
  const period = normalizeMeasurementPeriod(measurementPeriod);
  if (!period) throw new Error("지원하지 않는 측정주기입니다.");
  return `${normalizeText(businessName)}(${normalizeText(measurementYear)}년 ${period})`;
}

export function sanitizeWindowsFilename(value: unknown, fallback = "사업장"): string {
  const sanitized = normalizeText(value)
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim();
  return sanitized || fallback;
}

export function buildDocumentOutputPath(
  root: string,
  measurementYear: unknown,
  measurementPeriod: unknown,
  businessName: unknown,
  businessCode = "사업장"
): string {
  const period = normalizeMeasurementPeriod(measurementPeriod);
  if (!period) throw new Error("지원하지 않는 측정주기입니다.");
  const safeName = sanitizeWindowsFilename(businessName, normalizeText(businessCode) || "사업장");
  return [
    root.replace(/[\\/]+$/g, ""),
    `${normalizeText(measurementYear)}년`,
    period,
    "(((미확정 사업장)))",
    safeName,
  ].join("\\");
}

export function buildDocumentFilename(
  type: DocumentType,
  businessName: unknown,
  measurementYear: unknown,
  measurementPeriod: unknown
): string {
  const period = normalizeMeasurementPeriod(measurementPeriod);
  if (!period) throw new Error("지원하지 않는 측정주기입니다.");
  const year = normalizeText(measurementYear);
  const shortYear = year.slice(-2);
  const shortPeriod = period === "상반기" ? "상" : "하";
  const name = sanitizeWindowsFilename(businessName);
  if (type === "GENERAL_PRELIMINARY_SURVEY")
    return `${name}(예비조사표-${shortYear}${shortPeriod}).hwpx`;
  if (type === "FIELD_PRELIMINARY_SURVEY")
    return `${name}(현장 예비조사표-${shortYear}${shortPeriod}).hwpx`;
  return `★ ${name}(${shortYear}${shortPeriod})_화학물질입력 및 측정계획(V2.0).xlsm`;
}

export function isDocumentType(value: unknown): value is DocumentType {
  return DOCUMENT_TYPES.includes(value as DocumentType);
}
