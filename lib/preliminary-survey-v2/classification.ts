import type { BusinessKind } from "./types";

export interface MeasurementTargetClassificationKey {
  code: string;
  year: number;
  period: string;
}

export interface MeasurementJournalClassificationRow {
  id?: number | string | null;
  code: string;
  measurement_year: number;
  measurement_period: string;
  note: unknown;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface MeasurementJournalClassification {
  kind: BusinessKind;
  journalId: number | null;
  rawValue: string | null;
}

// 측정일지 UI의 일반 신규 체크값은 현재 "최초실시"로 저장된다.
// "신규"는 업무 용어/이전 데이터 호환값이며, "타기관 신규"와 함께 신규로 판정한다.
const NEW_NOTE_TOKENS = new Set(["신규", "최초실시", "타기관 신규"]);

function normalizePeriod(value: unknown): string {
  return String(value ?? "").trim();
}

function noteTokens(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function journalTimestamp(row: MeasurementJournalClassificationRow): number {
  const value = row.updated_at || row.created_at;
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 현재 측정대상의 code/year/period와 정확히 일치하는 최신 측정일지로 신규/기존을 판정한다. */
export function classifyMeasurementJournalBusiness(
  target: MeasurementTargetClassificationKey,
  rows: MeasurementJournalClassificationRow[],
): MeasurementJournalClassification {
  const matching = rows.filter((row) =>
    row.code === target.code &&
    Number(row.measurement_year) === Number(target.year) &&
    normalizePeriod(row.measurement_period) === normalizePeriod(target.period),
  ).sort((left, right) =>
    journalTimestamp(right) - journalTimestamp(left) || Number(right.id ?? 0) - Number(left.id ?? 0),
  );
  const current = matching[0];
  const rawValue = current?.note == null || String(current.note).trim() === "" ? null : String(current.note);
  const kind: BusinessKind = noteTokens(current?.note).some((token) => NEW_NOTE_TOKENS.has(token))
    ? "new"
    : "existing";

  return {
    kind,
    journalId: current?.id == null ? null : Number(current.id),
    rawValue,
  };
}
