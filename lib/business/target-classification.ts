export const BUSINESS_TYPES = [
  "existing",
  "first_measurement",
  "external_new",
] as const;

export type BusinessType = (typeof BUSINESS_TYPES)[number];

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === "string" && BUSINESS_TYPES.includes(value as BusinessType);
}

export function isNullableBusinessType(value: unknown): value is BusinessType | null {
  return value === null || isBusinessType(value);
}

export function isNullableProcessChanged(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

export function normalizeBusinessCategory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized !== "선택" ? normalized : null;
}

export function resolveTargetBusinessCategory(
  targetValue: unknown,
  ...fallbackValues: unknown[]
): string | null {
  const targetCategory = normalizeBusinessCategory(targetValue);
  if (targetCategory) return targetCategory;

  for (const fallbackValue of fallbackValues) {
    const fallbackCategory = normalizeBusinessCategory(fallbackValue);
    if (fallbackCategory) return fallbackCategory;
  }
  return null;
}

export function getInitialProcessChanged(
  explicitValue: unknown,
  hasExplicitValue: boolean,
  businessCategory: unknown,
): boolean | null {
  if (hasExplicitValue) {
    if (!isNullableProcessChanged(explicitValue)) {
      throw new TypeError("process_changed must be boolean or null");
    }
    return explicitValue;
  }

  const category = normalizeBusinessCategory(businessCategory);
  return category === "공업사" || category === "건설" ? true : null;
}

const BUSINESS_TYPE_TOKENS = new Set(["신규", "최초실시", "타기관 신규"]);
const PROCESS_CHANGED_TOKENS = new Set(["공정변경", "공정 변경", "공정 수시변경"]);

export function applyTargetClassificationToJournalNote(
  note: unknown,
  businessType: unknown,
  processChanged: unknown,
): string | null {
  const tokens = typeof note === "string"
    ? note.split(",").map((token) => token.trim()).filter(Boolean)
    : [];
  let result = [...tokens];

  if (isNullableBusinessType(businessType) && businessType !== null) {
    result = result.filter((token) => !BUSINESS_TYPE_TOKENS.has(token));
    if (businessType === "first_measurement") result.push("최초실시");
    if (businessType === "external_new") result.push("타기관 신규");
  }

  if (isNullableProcessChanged(processChanged) && processChanged !== null) {
    result = result.filter((token) => !PROCESS_CHANGED_TOKENS.has(token));
    if (processChanged) result.push("공정 변경");
  }

  const deduplicated = [...new Set(result)];
  return deduplicated.length ? deduplicated.join(",") : null;
}
