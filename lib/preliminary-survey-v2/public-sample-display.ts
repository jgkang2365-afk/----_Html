export interface V2MeasurementPublicSampleAssignment {
  assigneeUserId: number;
  surveyCode: string | null;
}

export interface LegacyMeasurementPublicSampleAssignment {
  code: string;
  year: number;
  period: string;
  measurementDate: string;
  measurer: string | null;
  surveyCode: string | null;
}

export interface MeasurementPublicSampleTargetKey {
  code: string;
  year: number;
  period: string;
  measurementDate: string;
}

export type MeasurementPublicSampleDisplaySource =
  | "v2"
  | "legacy_reconciled"
  | "legacy_snapshot"
  | "legacy_live_fallback"
  | "none";

export interface ReconciledMeasurementPublicSampleAssignment {
  measurer: string | null;
  surveyCode: string | null;
  appliedAssignmentId: string | null;
}

function label(name: unknown, surveyCode: unknown) {
  const normalizedName = String(name ?? "").trim();
  const normalizedCode = String(surveyCode ?? "").trim();
  return normalizedName && normalizedCode ? `${normalizedName}(${normalizedCode})` : "-";
}

function exactKey(value: MeasurementPublicSampleTargetKey) {
  return `${value.code.trim()}|${value.year}|${value.period.trim()}|${value.measurementDate}`;
}

function normalizedPeriod(value: string) {
  return value.trim().replace(/\s*\(수시\)\s*$/, "");
}

function normalizedKey(value: MeasurementPublicSampleTargetKey) {
  return `${value.code.trim()}|${value.year}|${normalizedPeriod(value.period)}|${value.measurementDate}`;
}

/** exact 복합키를 우선하고 `(수시)` 표기만 다른 후보는 하나일 때만 연결한다. */
export function buildLegacyMeasurementPublicSampleLookup(rows: readonly LegacyMeasurementPublicSampleAssignment[]) {
  const exact = new Map<string, LegacyMeasurementPublicSampleAssignment>();
  const normalized = new Map<string, LegacyMeasurementPublicSampleAssignment[]>();
  for (const row of rows) {
    exact.set(exactKey(row), row);
    const key = normalizedKey(row);
    normalized.set(key, [...(normalized.get(key) ?? []), row]);
  }
  return (target: MeasurementPublicSampleTargetKey) => {
    const exactMatch = exact.get(exactKey(target));
    if (exactMatch) return exactMatch;
    const candidates = normalized.get(normalizedKey(target)) ?? [];
    return candidates.length === 1 ? candidates[0] : null;
  };
}

export function resolveMeasurementPublicSampleDisplay(input: {
  v2Assignment: V2MeasurementPublicSampleAssignment | null;
  v2AssignmentId?: string | null;
  reconciliation?: ReconciledMeasurementPublicSampleAssignment | null;
  trueConfirmed: boolean;
  legacyAssignment: Pick<LegacyMeasurementPublicSampleAssignment, "measurer" | "surveyCode"> | null;
  userNameById: ReadonlyMap<number, string>;
}): { label: string; source: MeasurementPublicSampleDisplaySource } {
  if (input.v2Assignment && input.reconciliation
      && input.reconciliation.appliedAssignmentId === input.v2AssignmentId) {
    return {
      label: label(input.reconciliation.measurer, input.reconciliation.surveyCode),
      source: "legacy_reconciled",
    };
  }
  if (input.v2Assignment) {
    return {
      label: label(input.userNameById.get(input.v2Assignment.assigneeUserId), input.v2Assignment.surveyCode),
      source: "v2",
    };
  }
  if (input.reconciliation) {
    return {
      label: label(input.reconciliation.measurer, input.reconciliation.surveyCode),
      source: "legacy_snapshot",
    };
  }
  if (input.trueConfirmed && input.legacyAssignment) {
    return {
      label: label(input.legacyAssignment.measurer, input.legacyAssignment.surveyCode),
      source: "legacy_live_fallback",
    };
  }
  return { label: "-", source: "none" };
}
