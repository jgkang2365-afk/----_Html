export type SortDirection = "asc" | "desc";
export type SortFieldType = "string" | "number" | "date";
export interface SortRule { field: string; direction: SortDirection }

/** Column keys are authoritative; identifiers such as business codes stay strings. */
export const RESULT_SORT_FIELD_TYPES: Record<string, SortFieldType> = {
  code: "string", business_name: "string", measurement_year: "number", measurement_period: "string",
  designated_office: "string", designated_office_report_status: "string", office_jurisdiction: "string",
  national_support_status: "string", measurement_fee_business: "number", measurement_fee_national: "number",
  measurement_fee_total: "number", representative_name: "string", manager_name: "string",
  manager_mobile: "string", manager_email: "string", electronic_invoice_date: "date",
  measurement_start_date: "date", measurement_end_date: "date", preliminary_surveyor: "string",
  plan_manager: "string", actual_measurer: "string", report_writer: "string", measurer: "string",
  k2b_send_date: "date", note: "string", special_notes: "string",
};

export const isSortableField = (field: string): boolean =>
  Object.prototype.hasOwnProperty.call(RESULT_SORT_FIELD_TYPES, field);

export function normalizeSortRules(value: unknown): SortRule[] {
  if (!Array.isArray(value)) return [];
  const used = new Set<string>();
  const rules: SortRule[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { field, direction } = item as Record<string, unknown>;
    if (typeof field !== "string" || !isSortableField(field) || used.has(field)) continue;
    if (direction !== "asc" && direction !== "desc") continue;
    used.add(field);
    rules.push({ field, direction });
  }
  return rules;
}

/** An omitted property deliberately produces no DB update, preserving older clients' saved sorts. */
export function templateSortPatch(body: Record<string, unknown>): { sorts?: SortRule[] } | null {
  if (!Object.prototype.hasOwnProperty.call(body, "sorts")) return {};
  if (!Array.isArray(body.sorts)) return null;
  return { sorts: normalizeSortRules(body.sorts) };
}

const koreanCollator = new Intl.Collator("ko-KR", { sensitivity: "base", numeric: false });

function comparable(value: unknown, type: SortFieldType): string | number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (type === "string") return String(value).trim();
  if (type === "number") {
    const number = typeof value === "number" ? value : Number(String(value).replace(/,/g, "").trim());
    return Number.isFinite(number) ? number : null;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  const dateText = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(dateText);
  if (!match) return null;
  const calendarDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (new Date(calendarDay).toISOString().slice(0, 10) !== dateText.slice(0, 10)) return null;
  if (dateText.length === 10) return calendarDay;
  const time = Date.parse(dateText.replace(" ", "T"));
  return Number.isFinite(time) ? time : null;
}

/** Stable priority sort. Blank and malformed values follow valid values in both directions. */
export function sortResultRows<T extends Record<string, unknown>>(rows: T[], value: unknown): T[] {
  const rules = normalizeSortRules(value);
  if (rules.length === 0) return rows;
  return rows.map((row, index) => ({
    row, index,
    keys: rules.map((rule) => comparable(row[rule.field], RESULT_SORT_FIELD_TYPES[rule.field])),
  })).sort((a, b) => {
    for (let index = 0; index < rules.length; index++) {
      const rule = rules[index];
      const type = RESULT_SORT_FIELD_TYPES[rule.field];
      const left = a.keys[index];
      const right = b.keys[index];
      if (left === null || right === null) {
        if (left !== right) return left === null ? 1 : -1;
        continue;
      }
      const order = type === "string"
        ? koreanCollator.compare(left as string, right as string)
        : (left as number) - (right as number);
      if (order !== 0) return Math.sign(order) * (rule.direction === "asc" ? 1 : -1);
    }
    return a.index - b.index;
  }).map(({ row }) => row);
}
