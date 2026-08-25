import { createHash } from "node:crypto";
import { buildScheduleBlockKeys, type ScheduleBlockRange } from "./availability";

export const STAGE2_PROTECTED_CODES = new Set([
  "H0399", "H0524", "H0288", "H0528", "H0348",
  "H0126", "H0281", "H0260", "H0063", "H0077",
]);

export function normalizeReplayPeriod(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, "").toLowerCase();
}

export function replayJournalKey(code: unknown, year: unknown, period: unknown) {
  return `${String(code ?? "").trim()}|${Number(year)}|${normalizeReplayPeriod(period)}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

export function stableReplayJson(value: unknown) {
  return JSON.stringify(canonical(value));
}

export function replaySourceFingerprint(value: unknown) {
  return createHash("sha256").update(stableReplayJson(value)).digest("hex");
}

const FORBIDDEN_CLEAN_INPUT_KEYS = new Set([
  "measurer_id", "link_measurer_id", "collaborators", "responsible_user_id",
  "experienced_reviewer_id", "participant_user_ids", "participant_names",
  "recommendation_reason", "assignment_reason", "route_evidence",
  "measurementAssignments", "measurementAssignment", "measurementAssignee",
  "assignee_user_id", "approved_by_user_id", "approved_at", "approval_group_fingerprint",
]);

export const FORBIDDEN_LEGACY_ASSIGNMENT_FIELD_DETECTED =
  "FORBIDDEN_LEGACY_ASSIGNMENT_FIELD_DETECTED";

function assertNoForbiddenCleanInputField(value: unknown, path = "cleanInput") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoForbiddenCleanInputField(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_CLEAN_INPUT_KEYS.has(key)) {
      throw new Error(`${FORBIDDEN_LEGACY_ASSIGNMENT_FIELD_DETECTED}:${path}.${key}`);
    }
    assertNoForbiddenCleanInputField(item, `${path}.${key}`);
  }
}

function assertExactCleanKeys(value: unknown, allowed: readonly string[], path: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("CLEAN_INPUT_SCHEMA_MISMATCH");
  const unexpected = Object.keys(value as Record<string, unknown>).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    throw new Error(`${FORBIDDEN_LEGACY_ASSIGNMENT_FIELD_DETECTED}:${path}.${unexpected.sort()[0]}`);
  }
}

export interface PreliminarySurveyV2CleanInput {
  targets: Array<{
    id: number;
    code: string;
    year: number;
    period: string;
    businessName: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    measurementDate: string;
    measurementEndDate: string | null;
    measurementDates: string[];
    createdAt: string | null;
    businessType: string | null;
    preliminarySurveyRuleType: string | null;
    requiresFieldPreliminarySurvey: boolean;
    processChanged: boolean;
  }>;
  users: Array<{
    id: number;
    name: string;
    active: boolean | null;
    surveyCode: string | null;
    preliminarySurveyExperienced: boolean;
    preliminarySurveySupportAssignable: boolean;
    preliminarySurveyManager: boolean;
    administrator: boolean;
  }>;
  journals: Array<{
    id: number | string;
    code: string;
    measurementYear: number;
    measurementPeriod: string;
    note: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
  scheduleBlocks: Array<{
    id: number | string;
    userId: number;
    startDate: string;
    endDate: string;
    blockType: string | null;
  }>;
  policySettings: Array<{
    policyKey: string;
    enabled: boolean;
    effectiveStartYear: number | null;
    effectiveStartPeriod: string | null;
    effectiveStartMeasurementDate: string | null;
  }>;
}

function cleanMeasurementDates(target: any): string[] {
  const dates: string[] = Array.isArray(target?.daily_staff)
    ? target.daily_staff.map((day: any) => String(day?.date ?? "").trim()).filter(Boolean)
    : [];
  if (!dates.length && target?.measurement_date) dates.push(String(target.measurement_date));
  return [...new Set(dates)].sort();
}

/**
 * Stage 2 one-shot 계산에 허용된 원천만 새 객체로 조립한다.
 * 기존 V1/V2 plan과 모든 과거 사람 배정값은 의도적으로 입력 인자조차 받지 않는다.
 */
export function buildPreliminarySurveyV2CleanInput(raw: {
  targets?: any[];
  users?: any[];
  journals?: any[];
  businessInfo?: any[];
  blocks?: any[];
  policyRows?: any[];
}): PreliminarySurveyV2CleanInput {
  const coordinateByCode = new Map((raw.businessInfo ?? []).map((row) => [String(row.code), row]));
  const clean: PreliminarySurveyV2CleanInput = {
    targets: (raw.targets ?? []).map((row) => {
      const coordinate = coordinateByCode.get(String(row.code));
      return {
        id: Number(row.id), code: String(row.code), year: Number(row.year), period: String(row.period),
        businessName: String(row.business_name ?? ""), address: row.address == null ? null : String(row.address),
        latitude: coordinate?.latitude == null ? null : Number(coordinate.latitude),
        longitude: coordinate?.longitude == null ? null : Number(coordinate.longitude),
        measurementDate: String(row.measurement_date ?? ""),
        measurementEndDate: row.measurement_end_date == null ? null : String(row.measurement_end_date),
        measurementDates: cleanMeasurementDates(row), createdAt: row.created_at == null ? null : String(row.created_at),
        businessType: row.business_type == null ? null : String(row.business_type),
        preliminarySurveyRuleType: row.preliminary_survey_rule_type == null ? null : String(row.preliminary_survey_rule_type),
        requiresFieldPreliminarySurvey: row.requires_field_preliminary_survey === true,
        processChanged: row.process_changed === true,
      };
    }).sort((left, right) => left.measurementDate.localeCompare(right.measurementDate) || left.id - right.id),
    users: (raw.users ?? []).map((row) => ({
      id: Number(row.id), name: String(row.name ?? ""), active: row.is_active ?? null,
      surveyCode: row.survey_code == null ? null : String(row.survey_code),
      preliminarySurveyExperienced: row.is_preliminary_survey_experienced === true,
      preliminarySurveySupportAssignable: row.is_preliminary_survey_support_assignable === true,
      preliminarySurveyManager: row.is_preliminary_survey_manager === true,
      administrator: row.role === "관리자",
    })).sort((left, right) => left.id - right.id),
    journals: (raw.journals ?? []).map((row) => ({
      id: row.id, code: String(row.code), measurementYear: Number(row.measurement_year),
      measurementPeriod: String(row.measurement_period), note: row.note == null ? null : String(row.note),
      createdAt: row.created_at == null ? null : String(row.created_at),
      updatedAt: row.updated_at == null ? null : String(row.updated_at),
    })).sort((left, right) => String(left.id).localeCompare(String(right.id))),
    scheduleBlocks: (raw.blocks ?? []).map((row) => ({
      id: row.id, userId: Number(row.user_id), startDate: String(row.start_date), endDate: String(row.end_date),
      blockType: row.block_type == null ? null : String(row.block_type),
    })).sort((left, right) => left.userId - right.userId || left.startDate.localeCompare(right.startDate) ||
      left.endDate.localeCompare(right.endDate) || String(left.id).localeCompare(String(right.id))),
    policySettings: (raw.policyRows ?? []).map((row) => ({
      policyKey: String(row.policy_key), enabled: row.enabled === true,
      effectiveStartYear: row.effective_start_year == null ? null : Number(row.effective_start_year),
      effectiveStartPeriod: row.effective_start_period == null ? null : String(row.effective_start_period),
      effectiveStartMeasurementDate: row.effective_start_measurement_date == null
        ? null : String(row.effective_start_measurement_date),
    })).sort((left, right) => left.policyKey.localeCompare(right.policyKey)),
  };
  assertPreliminarySurveyV2CleanInput(clean);
  return clean;
}

export function assertPreliminarySurveyV2CleanInput(value: unknown): asserts value is PreliminarySurveyV2CleanInput {
  assertNoForbiddenCleanInputField(value);
  const clean = value as Partial<PreliminarySurveyV2CleanInput>;
  assertExactCleanKeys(clean, ["targets", "users", "journals", "scheduleBlocks", "policySettings"], "cleanInput");
  if (!Array.isArray(clean.targets) || !Array.isArray(clean.users) || !Array.isArray(clean.journals) ||
      !Array.isArray(clean.scheduleBlocks) || !Array.isArray(clean.policySettings)) {
    throw new Error("CLEAN_INPUT_SCHEMA_MISMATCH");
  }
  clean.targets.forEach((target, index) => assertExactCleanKeys(target, [
    "id", "code", "year", "period", "businessName", "address", "latitude", "longitude",
    "measurementDate", "measurementEndDate", "measurementDates", "createdAt", "businessType",
    "preliminarySurveyRuleType", "requiresFieldPreliminarySurvey", "processChanged",
  ], `cleanInput.targets[${index}]`));
  clean.users.forEach((user, index) => assertExactCleanKeys(user, [
    "id", "name", "active", "surveyCode", "preliminarySurveyExperienced",
    "preliminarySurveySupportAssignable", "preliminarySurveyManager", "administrator",
  ], `cleanInput.users[${index}]`));
  clean.journals.forEach((journal, index) => assertExactCleanKeys(journal, [
    "id", "code", "measurementYear", "measurementPeriod", "note", "createdAt", "updatedAt",
  ], `cleanInput.journals[${index}]`));
  clean.scheduleBlocks.forEach((block, index) => assertExactCleanKeys(block, [
    "id", "userId", "startDate", "endDate", "blockType",
  ], `cleanInput.scheduleBlocks[${index}]`));
  clean.policySettings.forEach((policy, index) => assertExactCleanKeys(policy, [
    "policyKey", "enabled", "effectiveStartYear", "effectiveStartPeriod", "effectiveStartMeasurementDate",
  ], `cleanInput.policySettings[${index}]`));
  const ids = clean.targets.map((target) => Number(target.id));
  if (ids.some((id) => !Number.isInteger(id)) || new Set(ids).size !== ids.length ||
      clean.targets.some((target) => !/^\d{4}-\d{2}-\d{2}$/.test(target.measurementDate) ||
        target.measurementDates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date)))) {
    throw new Error("CLEAN_INPUT_SCHEMA_MISMATCH");
  }
}

export interface ReplayCandidateUserState {
  id: number | string;
  is_active: boolean | null;
  survey_code: string | null;
  is_preliminary_survey_experienced: boolean | null;
  is_preliminary_survey_support_assignable: boolean | null;
}

export interface ReplayScheduleBlockSource extends ScheduleBlockRange {
  id?: number | string;
  block_type?: string | null;
}

/** Stage 2 stale guard에서 후보 직원 상태를 입력 순서와 무관하게 고정한다. */
export function canonicalReplayCandidateUsers(users: ReplayCandidateUserState[]) {
  return users.map((user) => ({
    id: Number(user.id),
    active: user.is_active,
    surveyCode: user.survey_code,
    preliminarySurveyExperienced: user.is_preliminary_survey_experienced,
    preliminarySurveySupportAssignable: user.is_preliminary_survey_support_assignable,
  })).sort((left, right) => left.id - right.id);
}

/** 후보 직원과 실제 후보일/측정일에 겹치는 일정만 target fingerprint source에 넣는다. */
export function canonicalReplayScheduleBlocks(input: {
  blocks: ReplayScheduleBlockSource[];
  candidateUserIds: Iterable<number>;
  relevantDates: Iterable<string>;
}) {
  const userIds = new Set([...input.candidateUserIds].map(Number));
  const dates = [...new Set(input.relevantDates)].sort();
  return input.blocks.filter((block) => userIds.has(Number(block.user_id)) &&
    dates.some((date) => block.start_date <= date && block.end_date >= date))
    .map((block) => ({
      id: block.id ?? null,
      userId: Number(block.user_id),
      startDate: block.start_date,
      endDate: block.end_date,
      blockType: block.block_type ?? null,
    }))
    .sort((left, right) => left.userId - right.userId ||
      left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate) ||
      String(left.blockType).localeCompare(String(right.blockType)) || String(left.id).localeCompare(String(right.id)));
}

/** 측정 역할은 예비조사 후보일 set과 분리하여 실제 측정일만 hard block으로 확장한다. */
export function measurementAssignmentBlockedKeys(
  blocks: ScheduleBlockRange[],
  measurementDates: Iterable<string>,
) {
  const dates = new Set(measurementDates);
  return new Set([...buildScheduleBlockKeys(blocks)].filter((key) => dates.has(key.slice(key.indexOf(":") + 1))));
}

export interface ReplayComparableResult {
  targetId: number;
  replayDate: string | null;
  responsibleUserId: number | null;
  reviewerUserId: number | null;
  participantUserIds: number[];
  measurementAssignments: Array<{
    measurementDate: string;
    assigneeUserId: number;
    surveyCode: string;
    approvalRequired: boolean;
  }>;
  warning: string[];
  status: string;
}

export function canonicalReplayResults(results: ReplayComparableResult[]) {
  return [...results].sort((left, right) => left.targetId - right.targetId).map((result) => ({
    ...result,
    participantUserIds: [...result.participantUserIds].sort((left, right) => left - right),
    measurementAssignments: [...result.measurementAssignments].sort((left, right) =>
      left.measurementDate.localeCompare(right.measurementDate) || left.assigneeUserId - right.assigneeUserId,
    ),
    warning: [...result.warning].sort(),
  }));
}

export function sameReplayResults(left: ReplayComparableResult[], right: ReplayComparableResult[]) {
  return stableReplayJson(canonicalReplayResults(left)) === stableReplayJson(canonicalReplayResults(right));
}

export function replayChangeType(input: {
  excluded?: "true_confirmed" | "protected" | "past_due" | "source_incomplete" | "hard_blocked" | "manual_required";
  manualPreserved?: boolean;
  currentDate: string | null;
  replayDate: string | null;
  currentResponsibleUserId: number | null;
  replayResponsibleUserId: number | null;
  measurementAssigneeChanged: boolean;
}) {
  if (input.excluded === "true_confirmed") return "true_confirmed_excluded";
  if (input.excluded === "protected") return "protected_excluded";
  if (input.excluded === "past_due") return "past_due_unmeasured";
  if (input.excluded === "source_incomplete") return "source_incomplete";
  if (input.excluded === "hard_blocked") return "hard_blocked";
  if (input.excluded === "manual_required") return "manual_required";
  if (input.manualPreserved && input.currentDate === input.replayDate &&
      input.currentResponsibleUserId === input.replayResponsibleUserId && !input.measurementAssigneeChanged) {
    return "manual_preserved";
  }
  const dateChanged = input.currentDate !== input.replayDate;
  const surveyorChanged = input.currentResponsibleUserId !== input.replayResponsibleUserId;
  if (dateChanged && surveyorChanged) return "date_and_surveyor_changed";
  if (dateChanged) return "date_changed";
  if (surveyorChanged) return "surveyor_changed";
  if (input.measurementAssigneeChanged) return "measurement_assignee_changed";
  return "unchanged";
}
