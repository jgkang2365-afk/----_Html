export const DEFAULT_RESULT_SEARCH_FIELDS = ["business_name"] as const;

/** Only configured result columns may be used as searchable fields. */
export function normalizeResultSearchFields(value: unknown, allowedFields: readonly string[]): string[] {
  const allowed = new Set(allowedFields);
  const selected = Array.isArray(value)
    ? value.filter((field): field is string => typeof field === "string" && allowed.has(field))
    : [];
  const uniqueFields = [...new Set(selected)];

  if (uniqueFields.length > 0) return uniqueFields;
  if (allowed.has(DEFAULT_RESULT_SEARCH_FIELDS[0])) return [...DEFAULT_RESULT_SEARCH_FIELDS];
  return allowedFields.length ? [allowedFields[0]] : [];
}

/**
 * Result-only quick search: comma/newline terms are OR, and selected columns
 * are also OR. This never changes the saved template's main filter rules.
 */
export function filterResultSearchRows<T extends Record<string, any>>(
  rows: T[],
  query: string,
  fields: readonly string[],
): T[] {
  const terms = query
    .split(/[,\n]/)
    .map((term) => term.trim().toLocaleLowerCase("ko-KR"))
    .filter(Boolean);

  if (terms.length === 0 || fields.length === 0) return rows;
  return rows.filter((row) =>
    terms.some((term) =>
      fields.some((field) => {
        const value = row[field];
        return value !== null &&
          value !== undefined &&
          String(value).toLocaleLowerCase("ko-KR").includes(term);
      }),
    ),
  );
}
