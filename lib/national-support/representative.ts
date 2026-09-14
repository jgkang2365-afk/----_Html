/** 건강디딤돌 전용 대표자 처리. 사람 이름의 구조는 추측하거나 분해하지 않는다. */
export function normalizeNationalSupportRepresentative(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function resolveNationalSupportRepresentative(
  override: unknown,
  baseRepresentative: unknown,
): string | null {
  return normalizeNationalSupportRepresentative(override)
    ?? normalizeNationalSupportRepresentative(baseRepresentative);
}

/** 기본 대표자와 같은 값 또는 빈 입력은 override를 저장하지 않는다. */
export function normalizeNationalSupportRepresentativeOverride(
  override: unknown,
  baseRepresentative: unknown,
): string | null {
  const normalizedOverride = normalizeNationalSupportRepresentative(override);
  const normalizedBase = normalizeNationalSupportRepresentative(baseRepresentative);
  return normalizedOverride && normalizedOverride !== normalizedBase ? normalizedOverride : null;
}
