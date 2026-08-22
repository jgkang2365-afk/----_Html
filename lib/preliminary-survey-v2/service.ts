import type { SupabaseClient } from "@supabase/supabase-js";
import { collectMeasurementStaffNames } from "@/lib/business/link-measurer";
import { classifyMeasurementJournalBusiness, type MeasurementJournalClassificationRow } from "./classification";
import { buildScheduleBlockKeys } from "./availability";
import { parseDateOnly, recommendationDates, recommendationDatesForBusinessType } from "./calendar";
import { recommendBatch } from "./engine";
import { validateManualPlanHardRules } from "./manual-validation";
import { loadActualMeasurementBlockedKeys } from "./measurement-conflicts";
import { measurementStaffForDate } from "./measurement-staff";
import {
  PROCESS_CHANGED_POLICY_OFF,
  shouldApplyProcessChangedPolicy,
  targetChangeRecommendationPolicy,
  isPreliminarySurveyV2AutomationEnabled,
  type ProcessChangedPolicySettings,
} from "./policy";
import { createRouteMetrics } from "./route-metrics";
import { recommendSurveyors, type SurveyorRecommendation } from "./surveyor-recommendation";
import { surveyMethodForKind, type ExistingAssignment, type RecommendationResult, type RouteMetrics, type SurveyTarget, type SurveyUser } from "./types";

type Client = SupabaseClient<any, "public", any>;

function regionFromAddress(value: unknown): string | null {
  const parts = String(value ?? "").trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || null;
  return `${parts[0]} ${parts[1]}`;
}

function coordinateFromRow(row: any) {
  const coordinate = row && { latitude: Number(row.latitude), longitude: Number(row.longitude) };
  return coordinate && coordinate.latitude >= 33 && coordinate.latitude <= 39 &&
    coordinate.longitude >= 124 && coordinate.longitude <= 132 ? coordinate : null;
}

function measurementAssignmentDates(
  measurementDate: unknown,
  measurementEndDate: unknown,
  dailyStaff: unknown,
): string[] | null {
  const start = String(measurementDate ?? "");
  const end = String(measurementEndDate ?? start);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  if (end === start) return [start];
  if (!Array.isArray(dailyStaff) || dailyStaff.length < 2) return null;
  const dates = dailyStaff.map((day: any) => String(day?.date ?? ""));
  if (dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date)) || new Set(dates).size !== dates.length) return null;
  const sorted = [...dates].sort();
  return sorted[0] === start && sorted.at(-1) === end ? sorted : null;
}

function optionalInteger(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

async function loadProcessChangedPolicy(supabase: Client): Promise<ProcessChangedPolicySettings> {
  const { data, error } = await supabase
    .from("preliminary_survey_policy_settings")
    .select("enabled, effective_start_year, effective_start_period, effective_start_measurement_date")
    .eq("policy_key", "process_changed_preliminary_survey")
    .maybeSingle();
  const policyTableMissing = error?.code === "42P01" || error?.code === "PGRST205";
  if (error && !policyTableMissing) throw new Error(`V2_PROCESS_CHANGED_POLICY_QUERY_FAILED:${error.message}`);
  if (!data) return PROCESS_CHANGED_POLICY_OFF;
  return {
    enabled: data.enabled === true,
    effectiveStartYear: data.effective_start_year == null ? null : Number(data.effective_start_year),
    effectiveStartPeriod: data.effective_start_period == null ? null : String(data.effective_start_period),
    effectiveStartMeasurementDate: data.effective_start_measurement_date == null
      ? null
      : String(data.effective_start_measurement_date),
  };
}

export async function loadV2ManualContext(supabase: Client, targetId: number, recommendedDate: string) {
  const { data: targetRow, error: targetError } = await supabase.from("measurement_target_business").select(
    "id, code, year, period, business_name, address, measurement_date, measurement_end_date, measurer_id, link_measurer_id, collaborators, daily_staff, created_at, business_type, process_changed, preliminary_survey_rule_type",
  ).eq("id", targetId).single();
  if (targetError || !targetRow) throw new Error("TARGET_NOT_FOUND");
  const [{ data: userRows, error: userError }, { data: infoRow, error: infoError }, { data: journalRows, error: journalError }, policy] = await Promise.all([
    supabase.from("users").select("id, name, job, is_active, is_preliminary_survey_experienced").eq("job", "측정"),
    supabase.from("business_info").select("code, latitude, longitude").eq("code", targetRow.code).maybeSingle(),
    supabase.from("measurement_journal").select(
      "id, code, measurement_year, measurement_period, note, updated_at, created_at",
    ).eq("code", targetRow.code).eq("measurement_year", targetRow.year).eq("measurement_period", targetRow.period)
      .order("updated_at", { ascending: false }).order("created_at", { ascending: false }),
    loadProcessChangedPolicy(supabase),
  ]);
  if (userError) throw new Error(`V2_USER_QUERY_FAILED:${userError.message}`);
  if (infoError) throw new Error(`V2_COORDINATE_QUERY_FAILED:${infoError.message}`);
  if (journalError) throw new Error(`V2_JOURNAL_QUERY_FAILED:${journalError.message}`);
  const users: SurveyUser[] = (userRows ?? []).map((user: any) => ({
    id: Number(user.id), name: user.name, experienced: Boolean(user.is_preliminary_survey_experienced), active: user.is_active,
  }));
  const userNameById = new Map(users.map((user) => [user.id, user.name]));
  const measurementParticipantsSnapshot = measurementStaffForDate({
    dailyStaff: targetRow.daily_staff,
    measurementDate: targetRow.measurement_date,
    collaborators: targetRow.collaborators,
    userNameById,
  }).measurementParticipants;
  // 수동 검증 context의 responsible는 제출된 예비조사 draft로 교체된다.
  // legacy link_measurer_id·보고서 담당자·측정 참여자에서 예비조사자를 추론하지 않는다.
  const responsible = users.find((user) => user.active !== false);
  if (!responsible) throw new Error("NO_ACTIVE_PRELIMINARY_SURVEYOR");
  const classification = classifyMeasurementJournalBusiness({
    code: targetRow.code, year: Number(targetRow.year), period: targetRow.period,
    business_type: targetRow.business_type,
    preliminary_survey_rule_type: targetRow.preliminary_survey_rule_type,
  }, (journalRows ?? []) as MeasurementJournalClassificationRow[]);
  const target: SurveyTarget = {
    id: Number(targetRow.id), code: targetRow.code, name: targetRow.business_name,
    kind: classification.kind, measurementDate: targetRow.measurement_date,
    measurementAssignmentDates: measurementAssignmentDates(
      targetRow.measurement_date, targetRow.measurement_end_date, targetRow.daily_staff,
    ), responsible,
    address: targetRow.address, region: regionFromAddress(targetRow.address), coordinate: coordinateFromRow(infoRow),
    createdAt: targetRow.created_at,
    businessType: targetRow.business_type,
    sourceMeasurerId: optionalInteger(targetRow.measurer_id),
    measurementParticipantsSnapshot,
    sourceDailyStaffSnapshot: targetRow.daily_staff ?? null,
    sourceCollaboratorsSnapshot: targetRow.collaborators ?? null,
    processChanged: targetRow.process_changed,
    processChangedPolicyApplicable: shouldApplyProcessChangedPolicy({
      policy,
      target: {
        year: Number(targetRow.year), period: targetRow.period,
        measurementDate: targetRow.measurement_date, processChanged: targetRow.process_changed,
      },
    }),
    classificationSource: {
      source: classification.source, journalId: classification.journalId, rawValue: classification.rawValue,
      measurementYear: Number(targetRow.year), measurementPeriod: String(targetRow.period).trim(),
    },
  };

  const { data: planRows, error: planError } = await supabase.from("preliminary_survey_v2_plans").select(
    "measurement_target_business_id, recommended_date, participant_user_ids, responsible_user_id, experienced_reviewer_id, status",
  ).eq("status", "recommended").eq("recommended_date", recommendedDate).neq("measurement_target_business_id", targetId);
  const v2TableMissing = planError?.code === "42P01" || planError?.code === "PGRST205";
  if (planError && !v2TableMissing) throw new Error(`V2_PLAN_QUERY_FAILED:${planError.message}`);
  const plans = v2TableMissing ? [] : (planRows ?? []);
  const otherIds = plans.map((plan: any) => Number(plan.measurement_target_business_id));
  const { data: otherTargets, error: otherTargetError } = otherIds.length
    ? await supabase.from("measurement_target_business").select(
      "id, code, year, period, address, business_type, preliminary_survey_rule_type",
    ).in("id", otherIds)
    : { data: [], error: null };
  if (otherTargetError) throw new Error(`V2_TARGET_QUERY_FAILED:${otherTargetError.message}`);
  const otherCodes = [...new Set((otherTargets ?? []).map((row: any) => row.code))];
  const [{ data: otherJournals, error: otherJournalError }, { data: otherInfo, error: otherInfoError }] = await Promise.all([
    otherCodes.length ? supabase.from("measurement_journal").select(
      "id, code, measurement_year, measurement_period, note, updated_at, created_at",
    ).in("code", otherCodes) : Promise.resolve({ data: [], error: null }),
    otherCodes.length ? supabase.from("business_info").select("code, latitude, longitude").in("code", otherCodes)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (otherJournalError) throw new Error(`V2_JOURNAL_QUERY_FAILED:${otherJournalError.message}`);
  if (otherInfoError) throw new Error(`V2_COORDINATE_QUERY_FAILED:${otherInfoError.message}`);
  const otherTargetById = new Map((otherTargets ?? []).map((row: any) => [Number(row.id), row]));
  const otherInfoByCode = new Map((otherInfo ?? []).map((row: any) => [row.code, row]));
  const assignments: ExistingAssignment[] = plans.flatMap((plan: any) => {
    const row: any = otherTargetById.get(Number(plan.measurement_target_business_id));
    if (!row) return [];
    const kind = classifyMeasurementJournalBusiness({
      code: row.code, year: Number(row.year), period: row.period,
      business_type: row.business_type,
      preliminary_survey_rule_type: row.preliminary_survey_rule_type,
    },
      (otherJournals ?? []) as MeasurementJournalClassificationRow[]).kind;
    return [{
      targetId: Number(row.id), businessCode: row.code, kind, date: plan.recommended_date,
      participants: Array.isArray(plan.participant_user_ids) ? plan.participant_user_ids.map(Number) : [],
      responsibleUserId: Number(plan.responsible_user_id),
      experiencedReviewerId: plan.experienced_reviewer_id == null ? null : Number(plan.experienced_reviewer_id),
      coordinate: coordinateFromRow(otherInfoByCode.get(row.code)), region: regionFromAddress(row.address),
    }];
  });
  return { target, users, assignments };
}

export interface CalculationOptions {
  targetIds?: number[];
  year?: number;
  period?: string;
  measurementDateFrom?: string;
  measurementDateTo?: string;
  /** 측정예정일 필터와 별개인, 사용자가 지정한 예비조사일 추천 범위. */
  preliminaryDateFrom?: string;
  preliminaryDateTo?: string;
  createdBeforeOrAt?: string;
  allowExternalRoutes?: boolean;
  routeMetrics?: RouteMetrics;
}

export interface CalculationOutput {
  targets: SurveyTarget[];
  results: RecommendationResult[];
  missing: Array<{
    targetId: number; code: string; name: string; measurementDate: string;
    kind: "new" | "existing"; fields: string[];
    classificationSource: SurveyTarget["classificationSource"];
  }>;
  blockedKeys: string[];
}

function preliminaryDateScope(options: Pick<CalculationOptions, "preliminaryDateFrom" | "preliminaryDateTo">) {
  const from = options.preliminaryDateFrom;
  const to = options.preliminaryDateTo;
  if (from && !parseDateOnly(from)) throw new Error("INVALID_PRELIMINARY_DATE_FROM");
  if (to && !parseDateOnly(to)) throw new Error("INVALID_PRELIMINARY_DATE_TO");
  if (from && to && from > to) throw new Error("INVALID_PRELIMINARY_DATE_RANGE");
  return { from, to };
}

function isInPreliminaryDateScope(date: string, scope: { from?: string; to?: string }) {
  return (!scope.from || date >= scope.from) && (!scope.to || date <= scope.to);
}

export function filterPreliminaryCandidateDates<T extends { date: string }>(
  candidates: T[],
  options: Pick<CalculationOptions, "preliminaryDateFrom" | "preliminaryDateTo">,
) {
  const scope = preliminaryDateScope(options);
  return candidates.filter((candidate) => isInPreliminaryDateScope(candidate.date, scope));
}

function manualRequiredOutsidePreliminaryScope(result: RecommendationResult): RecommendationResult {
  return {
    ...result,
    status: "manual_required",
    date: null,
    participants: [],
    experiencedReviewer: null,
    evidence: {
      ...result.evidence,
      workingDaysBefore: null,
      range: null,
      capacityPass: null,
      selectionMode: null,
      selectionReason: "no_available_date",
      warnings: [...result.evidence.warnings, "NO_AVAILABLE_DATE_IN_PRELIMINARY_SCOPE"],
    },
    reason: "선택한 예비조사 기간과 업체별 후보일의 교집합에 추천 가능한 날짜가 없습니다.",
  };
}

function preservedTentativeResult(
  target: SurveyTarget,
  recommendation: SurveyorRecommendation,
  candidate: { workingDaysBefore: number } | undefined,
): RecommendationResult {
  const surveyMethod = recommendation.surveyMethod;
  return {
    targetId: target.id,
    status: "recommended",
    date: recommendation.date,
    participants: recommendation.participants,
    responsible: recommendation.responsible!,
    experiencedReviewer: recommendation.experiencedReviewer,
    surveyMethod,
    evidence: {
      classificationSource: target.classificationSource,
      processChangedPolicyApplicable: target.processChangedPolicyApplicable === true,
      surveyMethod,
      workingDaysBefore: candidate?.workingDaysBefore ?? null,
      range: candidate ? (candidate.workingDaysBefore >= 20 ? "primary" : "fallback") : null,
      capacityPass: 1,
      responsibleConflict: false,
      reviewerConflict: false,
      route: null,
      sameDayRoute: null,
      rejectedSameDayRoutes: [],
      singleCandidateAvailable: true,
      sameRouteMinutes: null,
      sameRouteThresholdMinutes: 30,
      hardMaximumMinutes: 60,
      selectionMode: "single",
      selectionReason: "single_available",
      experiencedNewAssignments: null,
      experiencedAllFieldAssignments: null,
      crossTypeOverlap: false,
      crossTypeOverlapAvoided: false,
      crossTypeOverlapReason: null,
      warnings: ["MINIMUM_CHANGE_PRESERVED"],
    },
    reason: "기존 유효 가확정 유지",
  };
}

/** SELECT 전용 계산 경로. 이 함수는 insert/update/upsert/rpc를 호출하지 않는다. */
export async function calculateV2Recommendations(
  supabase: Client,
  options: CalculationOptions = {},
): Promise<CalculationOutput> {
  const scope = preliminaryDateScope(options);
  let targetQuery = supabase.from("measurement_target_business").select(
    "id, code, year, period, business_name, address, measurement_date, measurement_end_date, measurer_id, link_measurer_id, collaborators, daily_staff, created_at, business_type, process_changed, preliminary_survey_rule_type",
  ).not("measurement_date", "is", null);
  if (options.targetIds?.length) targetQuery = targetQuery.in("id", options.targetIds);
  if (options.year != null) targetQuery = targetQuery.eq("year", options.year);
  if (options.period) targetQuery = targetQuery.eq("period", options.period);
  if (options.measurementDateFrom) targetQuery = targetQuery.gte("measurement_date", options.measurementDateFrom);
  if (options.measurementDateTo) targetQuery = targetQuery.lte("measurement_date", options.measurementDateTo);
  if (options.createdBeforeOrAt) targetQuery = targetQuery.lte("created_at", options.createdBeforeOrAt);
  const { data: rawTargets, error: targetError } = await targetQuery;
  if (targetError) throw new Error(`V2_TARGET_QUERY_FAILED:${targetError.message}`);
  const processChangedPolicy = await loadProcessChangedPolicy(supabase);

  const { data: rawUsers, error: userError } = await supabase.from("users").select(
    "id, name, job, is_active, is_preliminary_survey_experienced",
  ).eq("job", "측정");
  if (userError) throw new Error(`V2_USER_QUERY_FAILED:${userError.message}`);
  const users: SurveyUser[] = (rawUsers ?? []).map((user: any) => ({
    id: Number(user.id), name: user.name, experienced: Boolean(user.is_preliminary_survey_experienced), active: user.is_active,
  }));
  const activeUsers = users.filter((user) => user.active !== false).sort((left, right) => left.id - right.id);
  const userNameById = new Map(users.map((user) => [user.id, user.name]));
  const codes = [...new Set((rawTargets ?? []).map((target: any) => target.code))];
  const years = [...new Set((rawTargets ?? []).map((target: any) => Number(target.year)))];
  let journalQuery = supabase.from("measurement_journal").select(
    "id, code, measurement_year, measurement_period, note, updated_at, created_at",
  );
  if (codes.length) journalQuery = journalQuery.in("code", codes);
  if (years.length) journalQuery = journalQuery.in("measurement_year", years);
  const { data: rawJournals, error: journalError } = codes.length
    ? await journalQuery.order("updated_at", { ascending: false }).order("created_at", { ascending: false })
    : { data: [], error: null };
  if (journalError) throw new Error(`V2_JOURNAL_QUERY_FAILED:${journalError.message}`);
  const journalRows = (rawJournals ?? []) as MeasurementJournalClassificationRow[];

  const { data: infoRows, error: infoError } = codes.length
    ? await supabase.from("business_info").select("code, latitude, longitude").in("code", codes)
    : { data: [], error: null };
  if (infoError) throw new Error(`V2_COORDINATE_QUERY_FAILED:${infoError.message}`);
  const coordinateByCode = new Map((infoRows ?? []).map((row: any) => [row.code, {
    latitude: Number(row.latitude), longitude: Number(row.longitude),
  }]));

  const missing: CalculationOutput["missing"] = [];
  const sortedRows = [...(rawTargets ?? [])].sort((left: any, right: any) =>
    String(left.measurement_date).localeCompare(String(right.measurement_date)) || Number(left.id) - Number(right.id),
  );
  const targets = sortedRows.flatMap((row: any) => {
    const classification = classifyMeasurementJournalBusiness({
      code: row.code,
      year: Number(row.year),
      period: row.period,
      business_type: row.business_type,
      preliminary_survey_rule_type: row.preliminary_survey_rule_type,
    }, journalRows);
    const classificationSource = {
      source: classification.source,
      journalId: classification.journalId,
      rawValue: classification.rawValue,
      measurementYear: Number(row.year),
      measurementPeriod: String(row.period).trim(),
    };
    // 아래 순수 탐색 단계가 후보일별 조사자/조합을 고른다. 이 값은 탐색 전 placeholder일 뿐이다.
    const responsible = activeUsers[0];
    const fields = [
      !row.measurement_date && "measurement_date",
      !responsible && "active_preliminary_surveyor",
    ].filter(Boolean) as string[];
    if (fields.length) {
      missing.push({
        targetId: Number(row.id), code: row.code, name: row.business_name,
        measurementDate: row.measurement_date,
        kind: classification.kind,
        fields, classificationSource,
      });
      return [];
    }
    const rawCoordinate = coordinateByCode.get(row.code);
    const coordinate = rawCoordinate && rawCoordinate.latitude >= 33 && rawCoordinate.latitude <= 39 &&
      rawCoordinate.longitude >= 124 && rawCoordinate.longitude <= 132
      ? rawCoordinate : null;
    return [{
      id: Number(row.id), code: row.code, name: row.business_name, kind: classification.kind,
      measurementDate: row.measurement_date,
      measurementAssignmentDates: measurementAssignmentDates(row.measurement_date, row.measurement_end_date, row.daily_staff),
      responsible: responsible!, address: row.address,
      region: regionFromAddress(row.address), coordinate, createdAt: row.created_at, classificationSource,
      businessType: row.business_type,
      sourceMeasurerId: optionalInteger(row.measurer_id),
      measurementParticipantsSnapshot: measurementStaffForDate({
        dailyStaff: row.daily_staff,
        measurementDate: row.measurement_date,
        collaborators: row.collaborators,
        userNameById,
      }).measurementParticipants,
      sourceDailyStaffSnapshot: row.daily_staff ?? null,
      sourceCollaboratorsSnapshot: row.collaborators ?? null,
      processChanged: row.process_changed,
      processChangedPolicyApplicable: shouldApplyProcessChangedPolicy({
        policy: processChangedPolicy,
        target: {
          year: Number(row.year), period: row.period,
          measurementDate: row.measurement_date, processChanged: row.process_changed,
        },
      }),
    } satisfies SurveyTarget];
  });

  // 업체별 날짜 정책으로 먼저 후보를 만들고, 요청한 예비조사 기간과 교차한다.
  // 추천 엔진은 자체 후보 정책을 유지하므로, availability의 기간 차단과 함께 둘 다 만족해야 한다.
  const candidateDatesByTarget = new Map(targets.map((target) => [
    target.id,
    new Set(filterPreliminaryCandidateDates(
      target.businessType
        ? recommendationDatesForBusinessType(target.measurementDate, target.businessType)
        : recommendationDates(target.measurementDate),
      options,
    ).map((item) => item.date)),
  ]));
  const candidateDates = [...new Set([...candidateDatesByTarget.values()].flatMap((dates) => [...dates]))].sort();
  const earliest = candidateDates[0];
  const latest = candidateDates.at(-1);
  const { data: blocks, error: blockError } = earliest && latest
    ? await supabase.from("user_schedule_blocks").select("user_id, start_date, end_date").lte("start_date", latest).gte("end_date", "2024-01-01")
    : { data: [], error: null };
  if (blockError) throw new Error(`V2_BLOCK_QUERY_FAILED:${blockError.message}`);

  const blockedKeys = buildScheduleBlockKeys(blocks ?? []);
  const measurementBlockedKeys = await loadActualMeasurementBlockedKeys(
    supabase,
    candidateDates,
    users,
  );
  for (const key of measurementBlockedKeys) blockedKeys.add(key);

  const { data: queriedPlanRows, error: planError } = await supabase.from("preliminary_survey_v2_plans").select(
    "measurement_target_business_id, recommended_date, participant_user_ids, responsible_user_id, experienced_reviewer_id, status, plan_origin, source_rule_type, survey_method",
  ).eq("status", "recommended");
  const v2TableMissing = planError?.code === "42P01" || planError?.code === "PGRST205";
  if (planError && !v2TableMissing) throw new Error(`V2_PLAN_QUERY_FAILED:${planError.message}`);
  const planRows = v2TableMissing ? [] : (queriedPlanRows ?? []);
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const targetIds = new Set(targets.map((target) => target.id));
  const existingAssignments: ExistingAssignment[] = (planRows ?? []).flatMap((plan: any) => {
    if (!plan.recommended_date || targetIds.has(Number(plan.measurement_target_business_id))) return [];
    const target = targetById.get(Number(plan.measurement_target_business_id));
    return [{
      targetId: Number(plan.measurement_target_business_id), businessCode: target?.code ?? String(plan.measurement_target_business_id),
      kind: target?.kind ?? (plan.source_rule_type === "new" ? "new" : "existing"), date: plan.recommended_date,
      participants: Array.isArray(plan.participant_user_ids) ? plan.participant_user_ids.map(Number) : [],
      responsibleUserId: Number(plan.responsible_user_id), experiencedReviewerId: plan.experienced_reviewer_id ? Number(plan.experienced_reviewer_id) : null,
      surveyMethod: plan.survey_method === "field" ? "field" as const : "phone" as const,
      coordinate: target?.coordinate ?? null, region: target?.region ?? null,
    }];
  });

  const tentativeAssignments = (planRows ?? []).flatMap((plan: any) => {
    const target = targetById.get(Number(plan.measurement_target_business_id));
    // 과거 automatic plan은 새 정책의 정답으로 보존하지 않는다. 사용자가 적용한
    // manual plan만 현재 hard constraint를 통과할 때 minimum-change 후보로 유지한다.
    if (!target || !plan.recommended_date || plan.plan_origin !== "manual") return [];
    return [{
      targetId: target.id, businessCode: target.code, kind: target.kind, date: plan.recommended_date,
      participants: Array.isArray(plan.participant_user_ids) ? plan.participant_user_ids.map(Number) : [],
      responsibleUserId: Number(plan.responsible_user_id),
      experiencedReviewerId: plan.experienced_reviewer_id == null ? null : Number(plan.experienced_reviewer_id),
      surveyMethod: plan.survey_method === "field" ? "field" as const : "phone" as const,
      coordinate: target.coordinate, region: target.region, tentative: true,
    }];
  });
  const surveyorRecommendations = recommendSurveyors({
    targets: targets.map((target) => ({
      id: target.id, kind: target.kind, businessType: target.businessType, measurementDate: target.measurementDate,
      createdAt: target.createdAt, candidateDates: [...(candidateDatesByTarget.get(target.id) ?? [])],
    })),
    users,
    assignments: [...existingAssignments, ...tentativeAssignments],
    availability: { isBlocked: (userId, date) => !isInPreliminaryDateScope(date, scope) || blockedKeys.has(`${userId}:${date}`) },
  });
  const surveyorRecommendationByTarget = new Map(surveyorRecommendations.map((item) => [item.targetId, item]));
  const selectedTargets: SurveyTarget[] = targets.flatMap((target) => {
    const recommendation = surveyorRecommendationByTarget.get(target.id);
    if (recommendation?.responsible) return [{ ...target, responsible: recommendation.responsible }];
    missing.push({
      targetId: target.id, code: target.code, name: target.name, measurementDate: target.measurementDate,
      kind: target.kind, fields: ["available_preliminary_surveyor"], classificationSource: target.classificationSource,
    });
    return [];
  });
  const selectedTargetById = new Map(selectedTargets.map((target) => [target.id, target]));
  const preserved = surveyorRecommendations.flatMap((recommendation) => {
    if (!recommendation.preserved || !recommendation.responsible || !recommendation.date) return [];
    const target = selectedTargetById.get(recommendation.targetId);
    if (!target) return [];
    const candidate = (target.businessType
      ? recommendationDatesForBusinessType(target.measurementDate, target.businessType)
      : recommendationDates(target.measurementDate)
    ).find((item) => item.date === recommendation.date);
    return [preservedTentativeResult(target, recommendation, candidate)];
  });
  const preservedAssignments = preserved.map((result) => {
    const target = selectedTargetById.get(result.targetId)!;
    return {
      targetId: target.id, businessCode: target.code, kind: target.kind, date: result.date!,
      participants: result.participants.map((user) => user.id), responsibleUserId: result.responsible.id,
      experiencedReviewerId: result.experiencedReviewer?.id ?? null, coordinate: target.coordinate, region: target.region,
      surveyMethod: result.surveyMethod,
    } satisfies ExistingAssignment;
  });
  const flexibleTargets = selectedTargets.filter((target) => !surveyorRecommendationByTarget.get(target.id)?.preserved);
  const freshResults = await recommendBatch({
    targets: flexibleTargets, experiencedUsers: users.filter((user) => user.experienced && user.active !== false),
    existingAssignments: [...existingAssignments, ...preservedAssignments],
    availability: {
      isBlocked: (userId, date) => !isInPreliminaryDateScope(date, scope) || blockedKeys.has(`${userId}:${date}`),
    },
    routes: options.routeMetrics ?? createRouteMetrics(options.allowExternalRoutes === false ? "" : undefined),
  });
  const results = [...preserved, ...freshResults].map((result) => {
    const scopedCandidates = candidateDatesByTarget.get(result.targetId);
    const scopeRestricted = Boolean(scope.from || scope.to);
    return scopeRestricted && (scopedCandidates?.size === 0 || (result.date != null && !scopedCandidates?.has(result.date)))
      ? manualRequiredOutsidePreliminaryScope(result)
      : result;
  });
  return { targets: selectedTargets, results, missing, blockedKeys: [...blockedKeys] };
}

/** @deprecated 새 plan/자동 plan 저장은 workbench canonical draft + assignment 원자 RPC만 사용한다. */
export async function persistV2Recommendations(
  supabase: Client,
  output: CalculationOutput,
  options: { planOrigin?: "automatic" | "manual" } = {},
) {
  const targetById = new Map(output.targets.map((target) => [target.id, target]));
  const payload = output.results.flatMap((result) => {
    const target = targetById.get(result.targetId);
    if (!target) return [];
    return [{
      target_id: target.id,
      recommended_date: result.date,
      responsible_user_id: result.responsible.id,
      experienced_reviewer_id: result.experiencedReviewer?.id ?? null,
      participant_user_ids: result.participants.map((user) => user.id),
      participant_names: result.participants.map((user) => user.name),
      status: result.status,
      plan_origin: options.planOrigin ?? "automatic",
      source_measurement_date: target.measurementDate,
      // legacy column name과 달리 RPC stale-source는 measurer_id(보고서 담당자) snapshot을 검증한다.
      source_responsible_user_id: target.sourceMeasurerId,
      source_rule_type: target.kind,
      survey_method: result.surveyMethod,
      recommendation_reason: { reason: result.reason, evidence: result.evidence },
      route_evidence: {
        ...(result.evidence.route ?? {}),
        ...(result.evidence.sameDayRoute ?? {}),
        rejectedSameDayRoutes: result.evidence.rejectedSameDayRoutes,
      },
      warnings: result.evidence.warnings,
    }];
  });
  // 전체 결과를 하나의 PostgreSQL transaction에서 처리한다.
  // 한 건이라도 validation 실패하면 0건 저장(전체 rollback)된다.
  void supabase;
  void payload;
  throw new Error("V2_LEGACY_PERSIST_DISABLED_USE_WORKBENCH");
}

export async function recommendAndPersistV2(supabase: Client, targetIds: number[]) {
  const output = await calculateV2Recommendations(supabase, { targetIds });
  const plans = await persistV2Recommendations(supabase, output);
  return { ...output, plans };
}

export async function reconcileV2AfterTargetChange(
  supabase: Client,
  targetId: number,
  changes: {
    responsibleChanged: boolean;
    measurementDateChanged: boolean;
    businessTypeChanged?: boolean;
    processChangedChanged?: boolean;
    periodChanged?: boolean;
    yearChanged?: boolean;
  },
) {
  // 예비조사 자동추천 상위 정책 OFF이면 재추천/재계산을 수행하지 않는다. 기존 plan은 보존된다.
  const policy = await loadV2AutomationPolicy(supabase);
  if (!isPreliminarySurveyV2AutomationEnabled(policy)) {
    return { message: "예비조사 자동추천 정책이 중지되어 V2 재추천을 실행하지 않았습니다. 기존 방식으로 운영합니다." };
  }
  const { data: plan } = await supabase.from("preliminary_survey_v2_plans").select("*")
    .eq("measurement_target_business_id", targetId).maybeSingle();
  if (!plan) return null;
  if (changes.responsibleChanged) {
    const result = await recommendAndPersistV2(supabase, [targetId]);
    return { message: "보고서 담당자 변경으로 예비조사 일정 및 조사자가 자동 재추천되었습니다.", result };
  }
  // 분류/공정변경/기간 변경: 현재 target 기준으로 재계산하여 기존 row를 upsert로 갱신한다.
  // business_type이 authoritative이므로 journal이 이를 덮어쓰지 않는다.
  if (
    changes.businessTypeChanged ||
    changes.processChangedChanged ||
    changes.periodChanged ||
    changes.yearChanged
  ) {
    const result = await recommendAndPersistV2(supabase, [targetId]);
    return { message: "사업장 분류/기간 변경으로 예비조사 계획을 현재 기준으로 갱신했습니다.", result };
  }
  if (changes.measurementDateChanged) {
    const { data: target, error } = await supabase.from("measurement_target_business")
      .select("measurement_date").eq("id", targetId).single();
    if (error || !target?.measurement_date) return null;
    const policy = targetChangeRecommendationPolicy({
      responsibleChanged: false,
      measurementDateChanged: true,
      existingRecommendedDate: plan.recommended_date,
      nextMeasurementDate: target.measurement_date,
    });
    if (policy === "recalculate") {
      const result = await recommendAndPersistV2(supabase, [targetId]);
      return { message: "측정예정일 변경으로 기존 예비조사 계획이 불가능해 자동 재추천되었습니다.", result };
    }
    const context = await loadV2ManualContext(supabase, targetId, plan.recommended_date);
    const participantIds = Array.isArray(plan.participant_user_ids) ? plan.participant_user_ids.map(Number) : [];
    const participants = participantIds.flatMap((id: number) => context.users.find((user) => user.id === id) ?? []);
    const validation = await validateManualPlanHardRules({
      target: context.target, recommendedDate: plan.recommended_date, participants,
      existingAssignments: context.assignments, routes: createRouteMetrics(),
    });
    if (!validation.valid || plan.source_rule_type !== context.target.kind) {
      const result = await recommendAndPersistV2(supabase, [targetId]);
      return { message: "측정예정일 변경 후 기존 예비조사 계획의 업무규칙을 충족하지 않아 자동 재추천되었습니다.", result };
    }
    await supabase.from("preliminary_survey_v2_plans").update({
      source_measurement_date: target.measurement_date, updated_at: new Date().toISOString(),
    }).eq("id", plan.id);
  }
  return null;
}

// ============================================================
// steady-state 자동 생성 흐름
// ============================================================

export type SteadyStatePlanAction =
  | "created"        // 신규 plan 생성
  | "replaced"       // 기존 automatic plan 재추천/갱신
  | "unchanged"      // 기존 plan 유지 (manual 보존 또는 변경 없음)
  | "manual_required"// 추천 가능 날짜 없음
  | "confirmed"      // measurement_journal row 존재 → 자동 변경 금지
  | "paused"         // 예비조사 자동추천 정책 OFF → 자동 생성/재추천 중지
  | "blocked";       // 생성 조건 미충족 (측정일/실측정자 부족 등)

export interface SteadyStatePlanResult {
  action: SteadyStatePlanAction;
  plan?: Record<string, any> | null;
  /** 예·측 후보 = 추천 예비조사자 ∩ 실제 측정자 */
  linkCandidates?: string[];
  reason?: string | null;
  message?: string;
}

/**
 * 예비조사 V2 자동추천 상위 정책(enabled)을 로드한다.
 * 정책 테이블이 없으면 OFF로 안전 처리한다.
 */
export async function loadV2AutomationPolicy(supabase: Client): Promise<ProcessChangedPolicySettings> {
  const { data, error } = await supabase.from("preliminary_survey_policy_settings")
    .select("enabled, effective_start_year, effective_start_period, effective_start_measurement_date")
    .eq("policy_key", "process_changed_preliminary_survey")
    .maybeSingle();
  const policyTableMissing = error?.code === "42P01" || error?.code === "PGRST205";
  if (error && !policyTableMissing) throw new Error(`V2_AUTOMATION_POLICY_QUERY_FAILED:${error.message}`);
  if (!data) return PROCESS_CHANGED_POLICY_OFF;
  return {
    enabled: data.enabled === true,
    effectiveStartYear: data.effective_start_year == null ? null : Number(data.effective_start_year),
    effectiveStartPeriod: data.effective_start_period == null ? null : String(data.effective_start_period),
    effectiveStartMeasurementDate: data.effective_start_measurement_date == null
      ? null : String(data.effective_start_measurement_date),
  };
}

/**
 * steady-state: 측정일 + 실제 측정자만 있으면 V2 plan을 자동 생성/재추천한다.
 *
 * - 보고서 담당자(measurer_id)는 실제 측정자 판단·예비조사자 추천에 사용하지 않는다.
 * - 예·측 후보는 "추천 예비조사자 ∩ 실제 측정자"로 계산한다.
 * - measurement_journal row가 존재(찐확정)하면 자동 변경하지 않는다.
 * - 사용자가 수동 확정한 plan(plan_origin='manual')은 자동으로 덮어쓰지 않는다.
 * - upsert(measurement_target_business_id unique)로 중복 plan이 생기지 않는다.
 * - 자동추천 정책이 OFF이면 생성/재추천하지 않는다(paused). 기존 데이터는 보존된다.
 */
export async function ensureV2PlanForTarget(supabase: Client, targetId: number): Promise<SteadyStatePlanResult> {
  const { data: target, error: targetError } = await supabase.from("measurement_target_business")
    .select("id, code, year, period, business_name, address, measurement_date, daily_staff, collaborators, measurer_id, link_measurer_id, business_type, process_changed, preliminary_survey_rule_type, created_at")
    .eq("id", targetId).single();
  if (targetError || !target) return { action: "blocked", reason: "TARGET_NOT_FOUND" };

  // 예비조사 자동추천 상위 정책: OFF면 자동 생성/재추천을 수행하지 않는다.
  const policy = await loadV2AutomationPolicy(supabase);
  if (!isPreliminarySurveyV2AutomationEnabled(policy, {
    year: Number(target.year), period: target.period, measurementDate: target.measurement_date,
  })) {
    return {
      action: "paused",
      reason: "POLICY_DISABLED",
      message: "예비조사 자동추천 정책이 중지되어 있습니다. 기존 방식으로 예비조사를 관리합니다.",
    };
  }

  // 찐확정(measurement_journal row 존재) 보호
  const basePeriod = String(target.period).trim().replace("(수시)", "");
  const { data: confirmedJournal } = await supabase.from("measurement_journal")
    .select("id").eq("code", target.code).eq("measurement_year", Number(target.year))
    .like("measurement_period", `${basePeriod}%`).limit(1).maybeSingle();
  if (confirmedJournal) return { action: "confirmed", reason: "MEASUREMENT_JOURNAL_CONFIRMED" };

  if (!target.measurement_date) return { action: "blocked", reason: "NO_MEASUREMENT_DATE" };

  const staff = collectMeasurementStaffNames({ collaborators: target.collaborators, dailyStaff: target.daily_staff });
  if (staff.length === 0) return { action: "blocked", reason: "NO_STAFF" };

  const { data: existingPlan } = await supabase.from("preliminary_survey_v2_plans")
    .select("*").eq("measurement_target_business_id", targetId).maybeSingle();
  if (existingPlan && existingPlan.plan_origin === "manual") {
    return {
      action: "unchanged", plan: existingPlan, reason: "MANUAL_PLAN_PRESERVED",
      message: "사용자가 수동 확정한 예비조사 계획은 자동으로 덮어쓰지 않습니다.",
    };
  }

  const [{ data: users, error: userError }, { data: journals, error: journalError }, { data: blocks, error: blockError }] = await Promise.all([
    supabase.from("users").select("id, name, job, is_active, is_preliminary_survey_experienced").eq("job", "측정"),
    supabase.from("measurement_journal").select(
      "id, code, measurement_year, measurement_period, note, updated_at, created_at",
    ).eq("code", target.code).eq("measurement_year", Number(target.year)),
    supabase.from("user_schedule_blocks").select("user_id, start_date, end_date")
      .lte("start_date", target.measurement_date),
  ]);
  if (userError || journalError || blockError) {
    return { action: "blocked", reason: "V2_LOAD_FAILED" };
  }
  const userRows: SurveyUser[] = (users ?? []).map((user: any) => ({
    id: Number(user.id), name: user.name, experienced: Boolean(user.is_preliminary_survey_experienced),
    active: user.is_active,
  }));
  const userById = new Map(userRows.map((user) => [user.id, user]));

  // responsible(lead) 결정: 예·측(link)이 있으면 그것, 없으면 실제 측정자 중 첫 유효 인원.
  // 보고서 담당자(measurer_id)는 사용하지 않는다.
  const lead = steadyStateLeadUser(
    target.link_measurer_id == null ? null : Number(target.link_measurer_id),
    staff,
    userRows,
  );
  if (!lead) return { action: "blocked", reason: "LEAD_STAFF_NOT_FOUND" };

  const classification = classifyMeasurementJournalBusiness({
    code: target.code, year: Number(target.year), period: target.period,
    business_type: target.business_type,
    preliminary_survey_rule_type: target.preliminary_survey_rule_type,
  }, (journals ?? []) as MeasurementJournalClassificationRow[]);

  const surveyTarget: SurveyTarget = {
    id: Number(target.id), code: target.code, name: target.business_name, kind: classification.kind,
    measurementDate: target.measurement_date, responsible: lead,
    address: target.address, region: regionFromAddress(target.address), coordinate: null,
    createdAt: target.created_at,
    businessType: target.business_type, processChanged: target.process_changed,
    classificationSource: {
      source: classification.source, journalId: classification.journalId,
      rawValue: classification.rawValue, measurementYear: Number(target.year),
      measurementPeriod: String(target.period).trim(),
    },
  };

  const blockedKeys = buildScheduleBlockKeys(blocks ?? []);
  const results = await recommendBatch({
    targets: [surveyTarget],
    experiencedUsers: userRows.filter((user) => user.experienced && user.active !== false),
    existingAssignments: [],
    availability: { isBlocked: (userId, date) => blockedKeys.has(`${userId}:${date}`) },
    routes: createRouteMetrics(),
  });
  const result = results[0];
  if (!result) return { action: "blocked", reason: "V2_RECOMMEND_FAILED" };

  // 구형 steady-state 저장은 중지했지만, 추천 가능일이 없는 결과는
  // 기존 수동 지정 안내 의미를 보존한다. 이 분기는 DB를 변경하지 않는다.
  if (result.status === "manual_required") {
    return {
      action: "manual_required",
      reason: "NO_AVAILABLE_DATE_THROUGH_MINUS_3",
      message: "추천 가능한 예비조사일이 없어 작업대에서 수동 지정이 필요합니다.",
    };
  }

  const payload = [{
    target_id: Number(target.id),
    recommended_date: result.date,
    responsible_user_id: lead.id,
    experienced_reviewer_id: result.experiencedReviewer?.id ?? null,
    participant_user_ids: result.participants.map((user) => user.id),
    participant_names: result.participants.map((user) => user.name),
    status: result.status,
    plan_origin: "automatic",
    source_measurement_date: target.measurement_date,
    source_responsible_user_id: target.measurer_id,
    source_rule_type: classification.kind,
    survey_method: surveyMethodForKind(classification.kind),
    recommendation_reason: {
      reason: result.reason, classificationSource: classification,
      steadyState: true, source: "auto_generate",
    },
    route_evidence: {},
    warnings: result.evidence.warnings,
  }];

  void payload;
  return {
    action: "blocked",
    reason: "V2_LEGACY_PERSIST_DISABLED_USE_WORKBENCH",
    message: "구형 자동 저장 경로는 중지되었습니다. 예비조사 작업대에서 추천안을 검토·적용해 주세요.",
  };

}

/**
 * steady-state lead(예비조사 책임) 선정.
 * - link(예·측)가 지정되어 있으면 그것을 우선 사용한다.
 * - 아니면 실제 측정자 중 첫 번째로 유효한 사용자(측정 직원)를 사용한다.
 * - 보고서 담당자(measurer_id)는 기준으로 사용하지 않는다.
 */
export function steadyStateLeadUser(
  linkUserId: number | null,
  staffNames: string[],
  users: SurveyUser[],
): SurveyUser | null {
  if (linkUserId != null) {
    const linked = users.find((user) => user.id === linkUserId);
    if (linked) return linked;
  }
  for (const name of staffNames) {
    const user = users.find((candidate) => candidate.name === name);
    if (user) return user;
  }
  return null;
}

// ============================================================
// 주소 기반 예비조사 일정 묶음 추천 (대상 로딩)
// ============================================================

export interface GroupRecommendationLoadOptions {
  year?: number;
  period?: string;
  targetIds?: number[];
}

/**
 * 묶음 추천 입력 데이터 로드 (READ-ONLY).
 * - measurement_journal row가 존재하는 찐확정 대상은 제외한다.
 * - 좌표는 business_info(권위 저장소)를 최우선 사용하고, 없으면 행정구역(region) fallback.
 * - 가능한 예비조사일은 기존 추천일 규칙(recommendationDates)으로 계산.
 * - lead는 예·측(link) 우선, 없으면 실측정자 중 첫 유효 인원. 보고서 담당자는 미사용.
 */
export async function loadGroupRecommendationTargets(
  supabase: Client,
  options: GroupRecommendationLoadOptions,
) {
  let query = supabase.from("measurement_target_business")
    .select("id, code, year, period, business_name, address, measurement_date, daily_staff, collaborators, measurer_id, link_measurer_id, business_type, process_changed, preliminary_survey_rule_type, created_at");
  if (options.targetIds?.length) {
    query = query.in("id", options.targetIds);
  } else {
    if (options.year != null) query = query.eq("year", options.year);
    if (options.period != null) query = query.eq("period", options.period);
  }
  const { data: targets, error: targetError } = await query;
  if (targetError) throw new Error(`GROUP_TARGET_QUERY_FAILED:${targetError.message}`);

  const codes = [...new Set((targets ?? []).map((target: any) => target.code))];
  const [{ data: users, error: userError }, { data: infoRows, error: infoError }, { data: journalRows, error: journalError }, { data: confirmedRows, error: confirmedError }, { data: planRows, error: planError }] = await Promise.all([
    supabase.from("users").select("id, name, is_active, is_preliminary_survey_experienced").eq("job", "측정"),
    codes.length ? supabase.from("business_info").select("code, latitude, longitude, geocoding_status").in("code", codes)
      : Promise.resolve({ data: [], error: null }),
    codes.length ? supabase.from("measurement_journal").select("id, code, measurement_year, measurement_period, note, updated_at, created_at").in("code", codes)
      : Promise.resolve({ data: [], error: null }),
    codes.length ? supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", codes)
      : Promise.resolve({ data: [], error: null }),
    (targets ?? []).length ? supabase.from("preliminary_survey_v2_plans").select("measurement_target_business_id, plan_origin")
      .in("measurement_target_business_id", (targets ?? []).map((target: any) => Number(target.id)))
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (userError || infoError || journalError || confirmedError || planError) {
    throw new Error("GROUP_LOAD_FAILED");
  }

  const confirmedKeys = new Set((confirmedRows ?? []).map((row: any) =>
    `${row.code}|${row.measurement_year}|${String(row.measurement_period).trim().replace("(수시)", "")}`,
  ));
  // 사용자가 확정한 manual plan 대상은 재추천 대상에서 제외한다 (묶음 확정 직후 중복 재추천 방지).
  const manualPlanTargetIds = new Set((planRows ?? [])
    .filter((row: any) => row.plan_origin === "manual")
    .map((row: any) => Number(row.measurement_target_business_id)));
  const coordinateByCode = new Map((infoRows ?? []).map((row: any) => [row.code, {
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  }]));
  const userRows: SurveyUser[] = (users ?? []).map((user: any) => ({
    id: Number(user.id), name: user.name, experienced: Boolean(user.is_preliminary_survey_experienced),
    active: user.is_active,
  }));

  const result = (targets ?? []).flatMap((target: any) => {
    if (confirmedKeys.has(`${target.code}|${target.year}|${String(target.period).trim().replace("(수시)", "")}`)) {
      return [];
    }
    if (manualPlanTargetIds.has(Number(target.id))) {
      return [];
    }
    if (!target.measurement_date) return [];
    const staff = collectMeasurementStaffNames({ collaborators: target.collaborators, dailyStaff: target.daily_staff });
    if (staff.length === 0) return [];
    const lead = steadyStateLeadUser(
      target.link_measurer_id == null ? null : Number(target.link_measurer_id),
      staff,
      userRows,
    );
    const coordinate = coordinateByCode.get(target.code);
    const validCoordinate = coordinate && Number.isFinite(coordinate.latitude) && Number.isFinite(coordinate.longitude)
      && coordinate.latitude >= 33 && coordinate.latitude <= 39
      && coordinate.longitude >= 124 && coordinate.longitude <= 132
      ? coordinate
      : null;
    const classification = classifyMeasurementJournalBusiness({
      code: target.code, year: Number(target.year), period: target.period,
      business_type: target.business_type,
      preliminary_survey_rule_type: target.preliminary_survey_rule_type,
    }, (journalRows ?? []) as MeasurementJournalClassificationRow[]);
    return [{
      id: Number(target.id),
      code: target.code,
      name: target.business_name,
      kind: classification.kind,
      measurementDate: target.measurement_date,
      address: target.address,
      region: regionFromAddress(target.address),
      coordinate: validCoordinate,
      staffNames: staff,
      leadUserId: lead?.id ?? null,
      leadName: lead?.name ?? null,
      candidateDates: recommendationDates(target.measurement_date).map((item) => item.date),
    }];
  });

  return result;
}

// ============================================================
// 묶음 추천 확정(저장)
// ============================================================

export interface GroupConfirmInput {
  date: string;
  targetIds: number[];
  /** 사업장별 예·측 후보가 2명 이상일 때 사용자가 선택한 link_measurer_id */
  linkOverrides?: Record<number, number>;
}

export interface GroupConfirmFailure {
  targetId: number;
  code: string;
  reason: string;
}

export interface GroupConfirmResult {
  confirmed: Array<{ targetId: number; code: string }>;
  failed: GroupConfirmFailure[];
  /** true: 원자적(전부 성공 또는 전부 rollback) */
  atomic: boolean;
}

const CONFIRM_FAILURE_MESSAGES: Record<string, string> = {
  MEASUREMENT_JOURNAL_CONFIRMED: "유효한 측정일지가 있어 자동 변경할 수 없습니다. 관리자 예외 정비만 가능합니다.",
  MANUAL_PLAN_PRESERVED: "수동 확정된 예비조사 계획은 자동으로 덮어쓰지 않습니다.",
  STALE_MEASUREMENT_DATE: "측정일이 변경되어 추천 날짜가 더 이상 유효하지 않습니다.",
  NO_STAFF: "실제 측정자를 확인할 수 없습니다.",
  NO_SURVEYOR: "예비조사자를 확인할 수 없습니다.",
  NO_EXPERIENCED_REVIEWER: "최초/신규 사업장에 배정할 경력 예비조사자가 없습니다.",
  LINK_CANDIDATES_ZERO: "실제 측정자가 변경되어 예·측 조건을 만족하지 않습니다.",
  LINK_CANDIDATES_MULTIPLE_REQUIRE_SELECTION: "예·측 후보가 여러 명이므로 예·측을 선택해 주세요.",
  LINK_MEASURER_INVALID: "선택한 예·측이 예비조사자 또는 실제 측정 인원에 포함되지 않습니다.",
  TARGET_NOT_FOUND: "측정 대상 사업장을 찾을 수 없습니다.",
};

/**
 * 묶음 추천 확정.
 *
 * - 클라이언트가 보낸 date/participants/link를 그대로 신뢰하지 않고 서버가 최신 데이터로 재검증한다.
 * - 선택된 사업장만 반영 대상이며, 제외된 사업장은 건드리지 않는다.
 * - 사전 검증에서 실패한 사업장이 있으면 아무것도 저장하지 않는다 (부분 저장 없음).
 * - 전부 유효하면 원자적 RPC(confirm_preliminary_survey_group)로 저장한다.
 */
export async function confirmGroupRecommendation(
  supabase: Client,
  input: GroupConfirmInput,
): Promise<GroupConfirmResult> {
  const targetIds = [...new Set(input.targetIds.map(Number).filter(Number.isFinite))];
  if (targetIds.length === 0) {
    return { confirmed: [], failed: [{ targetId: 0, code: "GROUP", reason: "EMPTY_TARGETS" }], atomic: true };
  }

  const { data: targets, error: targetError } = await supabase.from("measurement_target_business").select(
    "id, code, year, period, measurement_date, daily_staff, collaborators, measurer_id, link_measurer_id, business_type, process_changed, preliminary_survey_rule_type",
  ).in("id", targetIds);
  if (targetError) throw new Error("CONFIRM_LOAD_FAILED");

  const targetCodes = [...new Set((targets ?? []).map((target: any) => target.code))];
  const [{ data: users, error: userError }, { data: journalRows, error: journalError }, { data: confirmedRows, error: confirmedError }, { data: planRows, error: planError }] = await Promise.all([
    supabase.from("users").select("id, name, is_active, is_preliminary_survey_experienced").eq("job", "측정"),
    targetCodes.length ? supabase.from("measurement_journal").select("id, code, measurement_year, measurement_period, note, updated_at, created_at").in("code", targetCodes)
      : Promise.resolve({ data: [], error: null }),
    targetCodes.length ? supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", targetCodes)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("preliminary_survey_v2_plans").select("id, measurement_target_business_id, plan_origin, survey_method").in("measurement_target_business_id", targetIds),
  ]);
  if (userError || journalError || confirmedError || planError) {
    throw new Error("CONFIRM_LOAD_FAILED");
  }

  const userRows: SurveyUser[] = (users ?? []).map((user: any) => ({
    id: Number(user.id), name: user.name, experienced: Boolean(user.is_preliminary_survey_experienced),
    active: user.is_active,
  }));
  const userById = new Map(userRows.map((user) => [user.id, user]));
  const confirmedKeys = new Set((confirmedRows ?? []).map((row: any) =>
    `${row.code}|${row.measurement_year}|${String(row.measurement_period).trim().replace("(수시)", "")}`,
  ));
  const planByTarget = new Map((planRows ?? []).map((row: any) => [Number(row.measurement_target_business_id), row]));
  const targetById = new Map((targets ?? []).map((target: any) => [Number(target.id), target]));

  const payloads: any[] = [];
  const failed: GroupConfirmFailure[] = [];

  for (const targetId of targetIds) {
    const target = targetById.get(targetId);
    if (!target) {
      failed.push({ targetId, code: String(targetId), reason: "TARGET_NOT_FOUND" });
      continue;
    }
    if (confirmedKeys.has(`${target.code}|${target.year}|${String(target.period).trim().replace("(수시)", "")}`)) {
      failed.push({ targetId, code: target.code, reason: "MEASUREMENT_JOURNAL_CONFIRMED" });
      continue;
    }
    const existingPlan = planByTarget.get(targetId);
    if (existingPlan?.plan_origin === "manual") {
      failed.push({ targetId, code: target.code, reason: "MANUAL_PLAN_PRESERVED" });
      continue;
    }
    const staff = collectMeasurementStaffNames({ collaborators: target.collaborators, dailyStaff: target.daily_staff });
    if (staff.length === 0) {
      failed.push({ targetId, code: target.code, reason: "NO_STAFF" });
      continue;
    }
    const validDates = new Set(recommendationDates(target.measurement_date).map((item) => item.date));
    if (!validDates.has(input.date)) {
      failed.push({ targetId, code: target.code, reason: "STALE_MEASUREMENT_DATE" });
      continue;
    }
    const lead = steadyStateLeadUser(
      target.link_measurer_id == null ? null : Number(target.link_measurer_id),
      staff,
      userRows,
    );
    if (!lead) {
      failed.push({ targetId, code: target.code, reason: "NO_SURVEYOR" });
      continue;
    }
    const classification = classifyMeasurementJournalBusiness({
      code: target.code, year: Number(target.year), period: target.period,
      business_type: target.business_type,
      preliminary_survey_rule_type: target.preliminary_survey_rule_type,
    }, (journalRows ?? []) as MeasurementJournalClassificationRow[]);

    const participants = [lead];
    let reviewerId: number | null = null;
    if (classification.kind === "new" && !lead.experienced) {
      const reviewer = userRows
        .filter((user) => user.experienced && user.active !== false && user.id !== lead.id)
        .sort((left, right) => left.id - right.id)[0];
      if (!reviewer) {
        failed.push({ targetId, code: target.code, reason: "NO_EXPERIENCED_REVIEWER" });
        continue;
      }
      participants.push(reviewer);
      reviewerId = reviewer.id;
    }

    const staffSet = new Set(staff);
    const candidateNames = participants.map((user) => user.name).filter((name) => staffSet.has(name));
    let linkId: number | null = input.linkOverrides?.[targetId] ?? null;
    if (linkId != null) {
      const linkUser = userById.get(linkId);
      if (!linkUser || !participants.some((user) => user.id === linkId) || !staffSet.has(linkUser.name)) {
        failed.push({ targetId, code: target.code, reason: "LINK_MEASURER_INVALID" });
        continue;
      }
    } else if (candidateNames.length === 1) {
      linkId = participants.find((user) => user.name === candidateNames[0])?.id ?? null;
      if (linkId == null) {
        failed.push({ targetId, code: target.code, reason: "LINK_MEASURER_INVALID" });
        continue;
      }
    } else if (candidateNames.length === 0) {
      failed.push({ targetId, code: target.code, reason: "LINK_CANDIDATES_ZERO" });
      continue;
    } else {
      failed.push({ targetId, code: target.code, reason: "LINK_CANDIDATES_MULTIPLE_REQUIRE_SELECTION" });
      continue;
    }

    payloads.push({
      target_id: targetId,
      date: input.date,
      participant_user_ids: participants.map((user) => user.id),
      participant_names: participants.map((user) => user.name),
      reviewer_user_id: reviewerId,
      link_measurer_id: linkId,
    });
  }

  // 사전 검증 실패가 하나라도 있으면 저장하지 않는다 (원자적: 전부 rollback).
  if (failed.length > 0) {
    return {
      confirmed: [],
      failed: failed.map((item) => ({ ...item, reason: CONFIRM_FAILURE_MESSAGES[item.reason] ?? item.reason })),
      atomic: true,
    };
  }

  const { data, error } = await supabase.rpc("confirm_preliminary_survey_group", { p_plans: payloads });
  if (error) {
    return {
      confirmed: [],
      failed: [{ targetId: 0, code: "GROUP", reason: error.message }],
      atomic: true,
    };
  }
  const saved = Array.isArray(data) ? data : [];
  return {
    confirmed: saved.map((plan: any) => ({
      targetId: Number(plan.measurement_target_business_id),
      code: targetById.get(Number(plan.measurement_target_business_id))?.code ?? String(plan.measurement_target_business_id),
    })),
    failed: [],
    atomic: true,
  };
}
