export function normalizeRegionKey(address: string | null | undefined): string | null {
  const normalized = String(address || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;

  const tokens = normalized.split(" ");
  const province = tokens[0];
  const district = tokens.find(
    (token, index) =>
      index > 0 && /(시|군|구)$/.test(token) && !/(특별시|광역시|특별자치시)$/.test(token),
  );
  if (!district) return province || null;
  return `${province} ${district}`;
}
