import { recommendationDatesForBusinessType } from "./calendar";
import { normalizeLegacyReconciliationPeriod } from "./legacy-reconciliation";

export const HISTORICAL_PLAN_RECOVERY_PROTECTED_CODES = new Set([
  "H0399", "H0524", "H0288", "H0528", "H0348",
  "H0126", "H0281", "H0260", "H0063", "H0077",
]);

export type HistoricalPlanRecoveryClassification =
  | "EXISTING_V2_PRESERVED"
  | "HISTORICAL_EXACT_RECOVERY"
  | "NO_VALID_HISTORICAL_DATE"
  | "AMBIGUOUS_LEGACY_SOURCE"
  | "USER_MAPPING_CONFLICT"
  | "PROTECTED_PRESERVED";

export interface HistoricalPlanRecoveryTarget {
  id: number;
  code: string;
  year: number;
  period: string;
  measurement_date: string;
}

export interface HistoricalPlanRecoveryLegacy {
  id: number;
  code: string;
  year: number;
  period: string;
  measurement_date: string;
  preliminary_surveyor: string | null;
}

export interface HistoricalPlanRecoveryUser {
  id: number;
  name: string;
  is_active: boolean | null;
  is_preliminary_survey_experienced: boolean | null;
  is_preliminary_survey_support_assignable: boolean | null;
}

export interface HistoricalPlanRecoveryPlan {
  id: string;
  measurement_target_business_id: number;
  recommended_date: string | null;
  responsible_user_id: number;
  survey_method: "field" | "phone";
  status: string;
}

export interface HistoricalPlanRecoveryManifestRow {
  targetId: number;
  code: string;
  year: number;
  period: string;
  measurementDate: string;
  legacyPreliminarySurveyId: number | null;
  legacyPreliminarySurveyor: string | null;
  participantUserIds: number[];
  participantNames: string[];
  derivedResponsibleUserId: number | null;
  derivedReviewerUserId: number | null;
  derivedPreliminaryDate: string | null;
  workingDaysBefore: number | null;
  surveyMethod: "phone";
  sourceResponsibleUserId: number | null;
  sourceHash: string;
  targetHash: string;
  contextHash: string;
  existingPlanId: string | null;
  classification: HistoricalPlanRecoveryClassification;
  exclusionReason: string | null;
}

function legacyNames(value: unknown) {
  const seen = new Set<string>();
  return String(value ?? "")
    .split(/[,|]/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && !seen.has(name) && Boolean(seen.add(name)));
}

function exactLegacyForTarget(
  target: HistoricalPlanRecoveryTarget,
  sources: readonly HistoricalPlanRecoveryLegacy[],
) {
  const sameBase = sources.filter((source) => source.code.trim() === target.code.trim()
    && Number(source.year) === Number(target.year)
    && source.measurement_date === target.measurement_date);
  const exact = sameBase.filter((source) => source.period.trim() === target.period.trim());
  if (exact.length > 0) return exact;
  return sameBase.filter((source) =>
    normalizeLegacyReconciliationPeriod(source.period) === normalizeLegacyReconciliationPeriod(target.period));
}

function exactActiveUserByName(users: readonly HistoricalPlanRecoveryUser[], name: string) {
  const matches = users.filter((user) => user.name.trim() === name && user.is_active !== false);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * 기존 V2 plan을 고정한 채 legacy 조사자 조합으로 가능한 역사 날짜만 결정한다.
 * realtime cutoff는 받지 않으며 기존업체 정책의 -20..-3, -25..-21 순서를 그대로 사용한다.
 */
export function buildHistoricalPlanRecoveryManifest(input: {
  targets: readonly HistoricalPlanRecoveryTarget[];
  legacySources: readonly HistoricalPlanRecoveryLegacy[];
  users: readonly HistoricalPlanRecoveryUser[];
  existingPlans: readonly HistoricalPlanRecoveryPlan[];
  scheduleBlockedKeys: ReadonlySet<string>;
  measurementBlockedKeys: ReadonlySet<string>;
  sourceHashes: ReadonlyMap<number, string>;
  targetHashes: ReadonlyMap<number, string>;
  contextHash: string;
  protectedCodes?: ReadonlySet<string>;
}): HistoricalPlanRecoveryManifestRow[] {
  const plansByTarget = new Map(input.existingPlans.map((plan) => [Number(plan.measurement_target_business_id), plan]));
  const occupied = input.existingPlans
    .filter((plan) => plan.status === "recommended" && Boolean(plan.recommended_date))
    .map((plan) => ({
      date: String(plan.recommended_date),
      responsibleUserId: Number(plan.responsible_user_id),
      surveyMethod: plan.survey_method,
    }));
  const protectedCodes = input.protectedCodes ?? HISTORICAL_PLAN_RECOVERY_PROTECTED_CODES;

  return [...input.targets]
    .sort((left, right) => left.measurement_date.localeCompare(right.measurement_date) || left.id - right.id)
    .map((target) => {
      const base = {
        targetId: target.id,
        code: target.code,
        year: target.year,
        period: target.period,
        measurementDate: target.measurement_date,
        legacyPreliminarySurveyId: null,
        legacyPreliminarySurveyor: null,
        participantUserIds: [],
        participantNames: [],
        derivedResponsibleUserId: null,
        derivedReviewerUserId: null,
        derivedPreliminaryDate: null,
        workingDaysBefore: null,
        surveyMethod: "phone" as const,
        sourceResponsibleUserId: null,
        sourceHash: "",
        targetHash: input.targetHashes.get(target.id) ?? "",
        contextHash: input.contextHash,
        existingPlanId: null,
      };
      const existingPlan = plansByTarget.get(target.id);
      if (existingPlan) {
        return {
          ...base,
          existingPlanId: existingPlan.id,
          classification: "EXISTING_V2_PRESERVED" as const,
          exclusionReason: null,
        };
      }

      const matches = exactLegacyForTarget(target, input.legacySources);
      if (matches.length !== 1) {
        return {
          ...base,
          classification: "AMBIGUOUS_LEGACY_SOURCE" as const,
          exclusionReason: matches.length === 0 ? "LEGACY_SOURCE_NOT_FOUND" : "LEGACY_SOURCE_NOT_UNIQUE",
        };
      }
      const source = matches[0];
      const names = legacyNames(source.preliminary_surveyor);
      const resolved = names.map((name) => exactActiveUserByName(input.users, name));
      const withSource = {
        ...base,
        legacyPreliminarySurveyId: source.id,
        legacyPreliminarySurveyor: source.preliminary_surveyor,
        participantNames: names,
        sourceHash: input.sourceHashes.get(source.id) ?? "",
      };
      if (!names.length || resolved.some((user) => user == null)) {
        return {
          ...withSource,
          participantUserIds: resolved.flatMap((user) => user ? [user.id] : []),
          classification: "USER_MAPPING_CONFLICT" as const,
          exclusionReason: "LEGACY_SURVEYOR_USER_NOT_UNIQUE",
        };
      }
      const participants = resolved as HistoricalPlanRecoveryUser[];
      const responsible = participants.find((user) => !user.is_preliminary_survey_experienced) ?? participants[0];
      const reviewer = participants
        .filter((user) => user.id !== responsible.id && user.is_preliminary_survey_experienced)
        .sort((left, right) => left.id - right.id)[0] ?? null;
      const mapped = {
        ...withSource,
        participantUserIds: participants.map((user) => user.id),
        derivedResponsibleUserId: responsible.id,
        derivedReviewerUserId: reviewer?.id ?? null,
        sourceResponsibleUserId: responsible.id,
      };
      if (protectedCodes.has(target.code)) {
        return {
          ...mapped,
          classification: "PROTECTED_PRESERVED" as const,
          exclusionReason: "PROTECTED_MANUAL_CORRECTION",
        };
      }

      const candidates = recommendationDatesForBusinessType(target.measurement_date, "existing");
      const candidate = candidates.find((item) => {
        if (participants.some((user) => input.scheduleBlockedKeys.has(`${user.id}:${item.date}`)
          || input.measurementBlockedKeys.has(`${user.id}:${item.date}`))) return false;
        const phoneCount = occupied.filter((plan) => plan.surveyMethod === "phone"
          && plan.date === item.date && plan.responsibleUserId === responsible.id).length;
        return phoneCount < 3;
      });
      if (!candidate) {
        return {
          ...mapped,
          classification: "NO_VALID_HISTORICAL_DATE" as const,
          exclusionReason: "NO_DATE_SATISFIES_FIXED_SURVEYOR_HARD_RULES",
        };
      }
      occupied.push({ date: candidate.date, responsibleUserId: responsible.id, surveyMethod: "phone" });
      return {
        ...mapped,
        derivedPreliminaryDate: candidate.date,
        workingDaysBefore: candidate.workingDaysBefore,
        classification: "HISTORICAL_EXACT_RECOVERY" as const,
        exclusionReason: null,
      };
    });
}
