export const LEGACY_RECONCILIATION_PROTECTED_CODES = new Set([
  "H0399", "H0524", "H0288", "H0528", "H0348",
  "H0126", "H0281", "H0260", "H0063", "H0077",
]);

export type LegacyReconciliationClassification =
  | "V2_ALREADY_AUTHORITATIVE"
  | "PLAN_AND_ASSIGNMENT_EXACT_RECOVERY"
  | "PLAN_ONLY_EXACT_RECOVERY"
  | "ASSIGNMENT_ONLY_EXACT_RECOVERY"
  | "SNAPSHOT_ONLY"
  | "NO_RECOVERABLE_SOURCE";

export interface LegacyReconciliationSourceRow {
  id: number;
  code: string;
  year: number;
  period: string;
  measurement_date: string;
  preliminary_surveyor: string | null;
  measurer: string | null;
  survey_code: string | null;
  actual_measurer?: string | null;
  report_writer?: string | null;
}

export interface LegacyReconciliationTargetRow {
  id: number;
  code: string;
  year: number;
  period: string;
  measurement_date: string;
  daily_staff: unknown;
}

export interface LegacyReconciliationPlanRow {
  id: string;
  measurement_target_business_id: number;
  status: string;
  recommended_date: string | null;
  survey_method: string | null;
}

export interface LegacyReconciliationAssignmentRow {
  id: string;
  plan_id: string;
  measurement_date: string;
}

export interface LegacyReconciliationUserRow {
  id: number;
  name: string;
  is_active: boolean | null;
  survey_code: string | null;
}

export interface LegacyReconciliationManifestRow {
  legacySurveyId: number;
  targetId: number | null;
  matchedResponsibleUserIds: number[];
  matchedPublicSampleUserId: number | null;
  sourceHash: string;
  classification: LegacyReconciliationClassification;
  exclusionReason: string | null;
}

export function normalizeLegacyReconciliationPeriod(value: unknown) {
  return String(value ?? "").trim().replace(/\s*\(수시\)\s*$/, "");
}

function targetDates(target: LegacyReconciliationTargetRow) {
  const dates = new Set([String(target.measurement_date)]);
  if (Array.isArray(target.daily_staff)) {
    for (const day of target.daily_staff) {
      if (day && typeof day === "object" && typeof (day as { date?: unknown }).date === "string") {
        dates.add(String((day as { date: string }).date));
      }
    }
  }
  return dates;
}

function uniqueUserByName(users: readonly LegacyReconciliationUserRow[], name: unknown) {
  const normalized = String(name ?? "").trim();
  if (!normalized) return null;
  const matches = users.filter((user) => user.name.trim() === normalized);
  return matches.length === 1 ? matches[0] : null;
}

function responsibleUserIds(users: readonly LegacyReconciliationUserRow[], value: unknown) {
  const tokens = [...new Set(String(value ?? "").split(/[,|]/).map((token) => token.trim()).filter(Boolean))];
  const resolved = tokens.map((token) => uniqueUserByName(users, token));
  return resolved.every(Boolean) ? resolved.map((user) => user!.id).sort((a, b) => a - b) : [];
}

/** 운영 row를 추측 없이 exact key로 분류한다. daily_staff에서는 명시된 날짜 key만 읽는다. */
export function buildLegacyReconciliationManifest(input: {
  sources: readonly LegacyReconciliationSourceRow[];
  targets: readonly LegacyReconciliationTargetRow[];
  plans: readonly LegacyReconciliationPlanRow[];
  assignments: readonly LegacyReconciliationAssignmentRow[];
  users: readonly LegacyReconciliationUserRow[];
  sourceHashes: ReadonlyMap<number, string>;
}): LegacyReconciliationManifestRow[] {
  const sourceKeyCounts = new Map<string, number>();
  for (const source of input.sources) {
    const key = `${source.code.trim()}|${source.year}|${normalizeLegacyReconciliationPeriod(source.period)}|${source.measurement_date}`;
    sourceKeyCounts.set(key, (sourceKeyCounts.get(key) ?? 0) + 1);
  }
  const planByTarget = new Map(input.plans.map((plan) => [Number(plan.measurement_target_business_id), plan]));
  const assignmentsByPlanDate = new Map(input.assignments.map((assignment) => [
    `${assignment.plan_id}|${assignment.measurement_date}`, assignment,
  ]));
  const assignmentGroupCount = new Map<string, number>();
  const assignmentUserByPlanDate = new Map<string, number>();
  for (const assignment of input.assignments as Array<LegacyReconciliationAssignmentRow & { assignee_user_id?: number }>) {
    const userId = Number(assignment.assignee_user_id);
    if (Number.isFinite(userId)) {
      assignmentUserByPlanDate.set(`${assignment.plan_id}|${assignment.measurement_date}`, userId);
      const key = `${assignment.measurement_date}|${userId}`;
      assignmentGroupCount.set(key, (assignmentGroupCount.get(key) ?? 0) + 1);
    }
  }

  return [...input.sources].sort((a, b) => a.id - b.id).map((source) => {
    const exact = input.targets.filter((target) => target.code === source.code && target.year === source.year
      && target.period.trim() === source.period.trim() && targetDates(target).has(source.measurement_date));
    const normalized = exact.length ? exact : input.targets.filter((target) => target.code === source.code
      && target.year === source.year && normalizeLegacyReconciliationPeriod(target.period) === normalizeLegacyReconciliationPeriod(source.period)
      && targetDates(target).has(source.measurement_date));
    const target = normalized.length === 1 ? normalized[0] : null;
    const plan = target ? planByTarget.get(Number(target.id)) ?? null : null;
    const existing = plan ? assignmentsByPlanDate.get(`${plan.id}|${source.measurement_date}`) ?? null : null;
    const measurer = uniqueUserByName(input.users, source.measurer);
    const currentCode = String(measurer?.survey_code ?? "").trim().toUpperCase();
    const validMeasurer = Boolean(measurer && measurer.is_active !== false && ["A", "B", "C", "D", "F", "G"].includes(currentCode));
    let classification: LegacyReconciliationClassification;
    let exclusionReason: string | null = null;
    const sourceKey = `${source.code.trim()}|${source.year}|${normalizeLegacyReconciliationPeriod(source.period)}|${source.measurement_date}`;
    if ((sourceKeyCounts.get(sourceKey) ?? 0) > 1) {
      classification = "SNAPSHOT_ONLY";
      exclusionReason = "DUPLICATE_LEGACY_SOURCE_KEY";
    } else if (existing) classification = "V2_ALREADY_AUTHORITATIVE";
    else if (!target) {
      classification = String(source.preliminary_surveyor ?? "").trim() || String(source.measurer ?? "").trim()
        || String(source.survey_code ?? "").trim() ? "SNAPSHOT_ONLY" : "NO_RECOVERABLE_SOURCE";
      exclusionReason = normalized.length > 1 ? "AMBIGUOUS_TARGET_KEY" : "TARGET_NOT_FOUND";
    } else if (!String(source.preliminary_surveyor ?? "").trim() && !String(source.measurer ?? "").trim()
      && !String(source.survey_code ?? "").trim()) {
      classification = "NO_RECOVERABLE_SOURCE";
      exclusionReason = "NO_LEGACY_PUBLIC_SAMPLE_SOURCE";
    } else if (LEGACY_RECONCILIATION_PROTECTED_CODES.has(target.code)) {
      classification = "SNAPSHOT_ONLY";
      exclusionReason = "PROTECTED_MANUAL_CORRECTION";
    } else if (plan && plan.status === "recommended" && plan.recommended_date && ["phone", "field"].includes(String(plan.survey_method))
      && validMeasurer) {
      const groupCount = assignmentGroupCount.get(`${source.measurement_date}|${measurer!.id}`) ?? 0;
      classification = groupCount < 2 ? "ASSIGNMENT_ONLY_EXACT_RECOVERY" : "SNAPSHOT_ONLY";
      if (classification === "SNAPSHOT_ONLY") exclusionReason = "ASSIGNMENT_APPROVAL_REQUIRED";
    } else if (String(source.preliminary_surveyor ?? "").trim() || String(source.measurer ?? "").trim()
      || String(source.survey_code ?? "").trim()) {
      classification = "SNAPSHOT_ONLY";
      exclusionReason = plan ? "ACTIVE_V2_GAP_NOT_EXACTLY_RECOVERABLE" : "V2_PLAN_NOT_EXACTLY_RECONSTRUCTABLE";
    } else classification = "NO_RECOVERABLE_SOURCE";
    return {
      legacySurveyId: source.id,
      targetId: target?.id ?? null,
      matchedResponsibleUserIds: responsibleUserIds(input.users, source.preliminary_surveyor),
      matchedPublicSampleUserId: measurer?.id ?? null,
      sourceHash: input.sourceHashes.get(source.id) ?? "",
      classification,
      exclusionReason,
    };
  });
}
