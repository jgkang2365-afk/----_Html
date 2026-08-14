import type { BusinessKind } from "./types";

export type TargetBusinessType = "existing" | "first_measurement" | "external_new";
export type ClassificationSource = "target_business_type" | "legacy_journal" | "legacy_rule_type";

export interface MeasurementTargetClassificationKey {
  code: string;
  year: number;
  period: string;
  business_type?: unknown;
  preliminary_survey_rule_type?: unknown;
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
  source: ClassificationSource;
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

function targetBusinessType(value: unknown): TargetBusinessType | null {
  return value === "existing" || value === "first_measurement" || value === "external_new"
    ? value
    : null;
}

function businessKindForTargetType(value: TargetBusinessType): BusinessKind {
  return value === "existing" ? "existing" : "new";
}

function businessKindForLegacyRuleType(value: unknown): BusinessKind | null {
  if (value === "existing") return "existing";
  if (value === "general_new" || value === "other_org_new" || value === "unconfirmed_new") return "new";
  return null;
}

function currentJournalClassification(
  target: MeasurementTargetClassificationKey,
  rows: MeasurementJournalClassificationRow[],
) {
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
  return { kind, journalId: current?.id == null ? null : Number(current.id), rawValue };
}

/** 현재 측정대상의 code/year/period와 정확히 일치하는 최신 측정일지로 신규/기존을 판정한다. */
export function classifyMeasurementJournalBusiness(
  target: MeasurementTargetClassificationKey,
  rows: MeasurementJournalClassificationRow[],
): MeasurementJournalClassification {
  const authoritativeBusinessType = targetBusinessType(target.business_type);
  if (authoritativeBusinessType) {
    return {
      kind: businessKindForTargetType(authoritativeBusinessType),
      source: "target_business_type",
      journalId: null,
      rawValue: authoritativeBusinessType,
    };
  }

  const journal = currentJournalClassification(target, rows);
  // 기존 V2의 일지 기반 판정은 business_type이 없는 과거 target에서 계속 우선한다.
  if (journal.journalId !== null) {
    return { ...journal, source: "legacy_journal" };
  }

  const legacyRuleKind = businessKindForLegacyRuleType(target.preliminary_survey_rule_type);
  if (legacyRuleKind) {
    return {
      kind: legacyRuleKind,
      source: "legacy_rule_type",
      journalId: null,
      rawValue: String(target.preliminary_survey_rule_type),
    };
  }

  return {
    ...journal,
    source: "legacy_journal",
  };
}
