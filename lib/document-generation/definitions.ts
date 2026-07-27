import { randomUUID } from "crypto";
import { normalizeText } from "./constants";

export const DOCUMENT_FILE_FORMATS = ["HWPX", "XLSX", "XLSM"] as const;
export type DocumentFileFormat = (typeof DOCUMENT_FILE_FORMATS)[number];

export const DOCUMENT_TARGET_TYPES = ["HWPX_FIELD", "EXCEL_CELL"] as const;
export type DocumentTargetType = (typeof DOCUMENT_TARGET_TYPES)[number];

export const DOCUMENT_SOURCE_FIELDS = [
  { value: "measurement_year", label: "측정연도" },
  { value: "measurement_period", label: "측정주기" },
  { value: "business_id", label: "사업장 ID" },
  { value: "business_code", label: "사업장 코드" },
  { value: "business_name", label: "사업장명" },
  { value: "representative_name", label: "대표자명" },
  { value: "address", label: "주소" },
  { value: "business_category", label: "업종" },
  { value: "phone", label: "전화번호" },
  { value: "main_product", label: "주요 생산품" },
  { value: "fax", label: "팩스" },
  { value: "total_employees", label: "총 근로자 수" },
  { value: "manager_name", label: "담당자명" },
  { value: "manager_email", label: "담당자 이메일" },
  { value: "manager_mobile", label: "담당자 휴대전화" },
  { value: "manager_phone", label: "담당자 전화번호" },
  { value: "manager_contact", label: "담당자 연락처" },
  { value: "invoice_email", label: "전자계산서 이메일" },
  { value: "business_number", label: "사업자등록번호" },
  { value: "industrial_accident_number", label: "산재관리번호" },
  { value: "preliminary_surveyor", label: "예비조사자" },
  { value: "labor_office_name", label: "관할 고용노동관서명" },
  { value: "labor_office_phone", label: "관할 고용노동관서 전화번호" },
  { value: "labor_office_fax", label: "관할 고용노동관서 팩스번호" },
  { value: "business_year_period_label", label: "사업장명·연도·주기" },
] as const;

export const FILENAME_PATTERN_VARIABLES = [
  "business_name",
  "business_code",
  "year",
  "short_year",
  "period",
  "short_period",
  "document_name",
] as const;

const SOURCE_FIELD_SET = new Set<string>(DOCUMENT_SOURCE_FIELDS.map(({ value }) => value));
const FILE_FORMAT_SET = new Set<string>(DOCUMENT_FILE_FORMATS);
const TARGET_TYPE_SET = new Set<string>(DOCUMENT_TARGET_TYPES);
const FILENAME_VARIABLE_SET = new Set<string>(FILENAME_PATTERN_VARIABLES);
const A1_ADDRESS = /^[A-Z]{1,3}[1-9][0-9]*$/;

export interface DocumentDefinitionInput {
  name: string;
  file_format: DocumentFileFormat;
  filename_pattern: string;
  default_selected: boolean;
  sort_order: number;
  is_active: boolean;
}

export interface DocumentFieldMappingInput {
  source_field: string;
  target_type: DocumentTargetType;
  target_sheet: string | null;
  target_address: string;
  required: boolean;
  default_value: string | null;
  sort_order: number;
}

export function isDocumentFileFormat(value: unknown): value is DocumentFileFormat {
  return FILE_FORMAT_SET.has(normalizeText(value).toUpperCase());
}

export function documentExtension(format: DocumentFileFormat): ".hwpx" | ".xlsx" | ".xlsm" {
  if (format === "HWPX") return ".hwpx";
  if (format === "XLSX") return ".xlsx";
  return ".xlsm";
}

export function createDocumentCode(): string {
  return `CUSTOM_${randomUUID().replace(/-/g, "").toUpperCase()}`;
}

export function validateFilenamePattern(value: unknown): string {
  const pattern = normalizeText(value);
  if (!pattern) throw new Error("출력 파일명 규칙이 필요합니다.");
  if (/\.(?:hwpx|xlsx|xlsm)$/i.test(pattern))
    throw new Error("출력 파일명 규칙에는 확장자를 입력하지 마세요.");

  for (const match of pattern.matchAll(/\{([^{}]+)\}/g)) {
    if (!FILENAME_VARIABLE_SET.has(match[1]))
      throw new Error(`지원하지 않는 파일명 변수입니다: {${match[1]}}`);
  }
  const withoutKnownVariables = pattern.replace(/\{[^{}]+\}/g, "");
  if (/[{}]/.test(withoutKnownVariables))
    throw new Error("출력 파일명 규칙의 중괄호를 확인해 주세요.");
  return pattern;
}

export function parseDocumentDefinitionInput(
  value: any,
  defaults: Partial<DocumentDefinitionInput> = {}
): DocumentDefinitionInput {
  const name = normalizeText(value?.name ?? defaults.name);
  const rawFormat = normalizeText(value?.file_format ?? defaults.file_format).toUpperCase();
  if (!name) throw new Error("문서 종류명이 필요합니다.");
  if (!isDocumentFileFormat(rawFormat)) throw new Error("지원하지 않는 파일 형식입니다.");

  const rawOrder = value?.sort_order ?? defaults.sort_order ?? 0;
  const sortOrder = Number(rawOrder);
  if (!Number.isInteger(sortOrder)) throw new Error("표시 순서는 정수여야 합니다.");

  return {
    name,
    file_format: rawFormat,
    filename_pattern: validateFilenamePattern(value?.filename_pattern ?? defaults.filename_pattern),
    default_selected:
      typeof value?.default_selected === "boolean"
        ? value.default_selected
        : (defaults.default_selected ?? true),
    sort_order: sortOrder,
    is_active:
      typeof value?.is_active === "boolean" ? value.is_active : (defaults.is_active ?? true),
  };
}

export function parseDocumentFieldMappings(
  value: unknown,
  fileFormat: DocumentFileFormat
): DocumentFieldMappingInput[] {
  if (!Array.isArray(value)) throw new Error("입력 매핑 목록이 필요합니다.");
  const seen = new Set<string>();
  return value.map((raw: any, index) => {
    const sourceField = normalizeText(raw?.source_field);
    const targetType = normalizeText(raw?.target_type).toUpperCase();
    const targetAddress = normalizeText(raw?.target_address);
    const targetSheet = normalizeText(raw?.target_sheet) || null;
    const sortOrder = Number(raw?.sort_order ?? index);

    if (!SOURCE_FIELD_SET.has(sourceField))
      throw new Error(`허용하지 않는 DB 필드입니다: ${sourceField || "(빈 값)"}`);
    if (!TARGET_TYPE_SET.has(targetType)) throw new Error("지원하지 않는 입력 위치 형식입니다.");
    if (!targetAddress) throw new Error("입력 대상 위치가 필요합니다.");
    if (!Number.isInteger(sortOrder)) throw new Error("매핑 표시 순서는 정수여야 합니다.");
    if (fileFormat === "HWPX" && targetType !== "HWPX_FIELD")
      throw new Error("HWPX 문서는 누름틀 매핑만 사용할 수 있습니다.");
    if (fileFormat !== "HWPX" && targetType !== "EXCEL_CELL")
      throw new Error("Excel 문서는 셀 매핑만 사용할 수 있습니다.");
    if (targetType === "HWPX_FIELD" && targetSheet)
      throw new Error("HWPX 누름틀에는 시트명을 입력할 수 없습니다.");
    if (targetType === "EXCEL_CELL" && !targetSheet)
      throw new Error("Excel 셀 매핑에는 시트명이 필요합니다.");

    const normalizedAddress =
      targetType === "EXCEL_CELL" ? targetAddress.toUpperCase() : targetAddress;
    if (targetType === "EXCEL_CELL" && !A1_ADDRESS.test(normalizedAddress))
      throw new Error(`Excel 셀 주소가 A1 형식이 아닙니다: ${targetAddress}`);

    const targetKey =
      targetType === "EXCEL_CELL"
        ? `${targetType}:${targetSheet}:${normalizedAddress}`
        : `${targetType}:${normalizedAddress}`;
    if (seen.has(targetKey)) throw new Error("같은 입력 대상 위치를 중복 등록할 수 없습니다.");
    seen.add(targetKey);

    return {
      source_field: sourceField,
      target_type: targetType as DocumentTargetType,
      target_sheet: targetType === "EXCEL_CELL" ? targetSheet : null,
      target_address: normalizedAddress,
      required: raw?.required === true,
      default_value:
        raw?.default_value === null || raw?.default_value === undefined
          ? null
          : String(raw.default_value),
      sort_order: sortOrder,
    };
  });
}
