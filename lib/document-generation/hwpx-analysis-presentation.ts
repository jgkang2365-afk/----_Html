export type HwpxWarningSeverity = "info" | "caution" | "fatal";
export type HwpxMappingStatus = "normal" | "review" | "unmapped" | "error";

export type HwpxMappingReviewInput = {
  source_field?: string | null;
  target_address?: string | null;
  required?: boolean;
  default_value?: string | null;
  warnings?: string[];
  present_in_file?: boolean;
};

export type HwpxRegistrationReview = {
  can_register: boolean;
  status: "ready" | "review" | "blocked";
  confirmation_count: number;
  unmapped_count: number;
  fatal_count: number;
  issue_mappings: Array<{
    target_address: string;
    status: HwpxMappingStatus;
    warnings: Array<{ message: string; severity: HwpxWarningSeverity }>;
  }>;
};

const INTERNAL_CONTROL_VALUE = /(?:Clickhere\s*:|Direction\s*:\s*wstring\s*:|HelpState\s*:)/i;
const PLACEHOLDER_GUIDE_VALUES: Record<string, Set<string>> = {
  measurement_year: new Set(["측정연도", "측정년도", "년도"]),
  measurement_period: new Set(["측정주기", "주기"]),
  business_name: new Set(["사업장명"]),
  representative_name: new Set(["대표자", "대표자명"]),
  address: new Set(["주소"]),
  business_category: new Set(["업종", "업종분류"]),
  phone: new Set(["전화번호"]),
  main_product: new Set(["주요생산품", "주요 생산품"]),
  fax: new Set(["팩스"]),
  total_employees: new Set(["총 근로자수", "총 근로자 수"]),
  manager_name: new Set(["담당자", "담당자명"]),
  manager_email: new Set(["이메일", "담당자 이메일", "담당자 메일"]),
  manager_contact: new Set(["연락처", "담당자 연락처"]),
  preliminary_surveyor: new Set(["예비조사자"]),
  business_number: new Set(["사업자등록번호"]),
  industrial_accident_number: new Set(["산재관리번호"]),
};
const FATAL_WARNING =
  /(?:시작[·ㆍ\s-]*종료|짝이 맞지|내부 이름이 없는|구조적으로 안전|구조 오류)/;
const INFO_WARNING = /(?:동일 누름틀 이름이 \d+회 등장|동일 이름 누름틀 .*회|여러 회 사용)/;

export function sanitizeHwpxDefaultValue(value?: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() || "";
  if (!normalized || INTERNAL_CONTROL_VALUE.test(normalized)) return null;
  return normalized;
}

export function sanitizeHwpxMappingDefaultValue(
  sourceField: unknown,
  value?: string | null
): string | null {
  const sanitized = sanitizeHwpxDefaultValue(value);
  if (!sanitized) return null;
  const guideValues = PLACEHOLDER_GUIDE_VALUES[String(sourceField ?? "").trim()];
  return guideValues?.has(sanitized) ? null : sanitized;
}

export function classifyHwpxWarning(message: string): HwpxWarningSeverity {
  if (FATAL_WARNING.test(message)) return "fatal";
  if (INFO_WARNING.test(message)) return "info";
  return "caution";
}

export function getHwpxMappingStatus(mapping: HwpxMappingReviewInput): HwpxMappingStatus {
  const warnings = mapping.warnings || [];
  if (!mapping.target_address) return "error";
  if (warnings.some((warning) => classifyHwpxWarning(warning) === "fatal")) return "error";
  if (!mapping.source_field) return "unmapped";
  if (warnings.length > 0 || mapping.present_in_file === false) return "review";
  return "normal";
}

export function reviewHwpxRegistration(
  mappings: HwpxMappingReviewInput[]
): HwpxRegistrationReview {
  const issueMappings = mappings.flatMap((mapping) => {
    const status = getHwpxMappingStatus(mapping);
    if (status === "normal") return [];
    return [
      {
        target_address: mapping.target_address || "이름 없는 누름틀",
        status,
        warnings: (mapping.warnings || []).map((message) => ({
          message,
          severity: classifyHwpxWarning(message),
        })),
      },
    ];
  });
  const unmappedCount = mappings.filter((mapping) => !mapping.source_field).length;
  const fatalCount = issueMappings.filter(({ status }) => status === "error").length;
  const hasStaleMapping = mappings.some(({ present_in_file }) => present_in_file === false);
  const canRegister = fatalCount === 0 && unmappedCount === 0 && !hasStaleMapping;
  const confirmationCount = issueMappings.length;

  return {
    can_register: canRegister,
    status: canRegister ? (confirmationCount > 0 ? "review" : "ready") : "blocked",
    confirmation_count: confirmationCount,
    unmapped_count: unmappedCount,
    fatal_count: fatalCount,
    issue_mappings: issueMappings,
  };
}
