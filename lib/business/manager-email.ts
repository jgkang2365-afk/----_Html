export function normalizeOptionalManagerEmail(value: unknown): string | null {
  const email = String(value || "").trim();
  return email || null;
}

export function isValidOptionalManagerEmail(value: unknown): boolean {
  const email = normalizeOptionalManagerEmail(value);
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

