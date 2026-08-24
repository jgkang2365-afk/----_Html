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
const FATAL_WARNING =
  /(?:시작[·ㆍ\s-]*종료|짝이 맞지|내부 이름이 없는|구조적으로 안전|구조 오류)/;
const INFO_WARNING = /(?:동일 누름틀 이름이 \d+회 등장|동일 이름 누름틀 .*회|여러 회 사용)/;

export function sanitizeHwpxDefaultValue(value?: string | null): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() || "";
  if (!normalized || INTERNAL_CONTROL_VALUE.test(normalized)) return null;
  return normalized;
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
