import type { SupabaseClient } from "@supabase/supabase-js";
import { recommendPreliminarySurvey } from "./engine";
import { normalizeRegionKey } from "./region";
import {
  isNewPreliminarySurveyRule,
  RecommendationResult,
  RecommendationUser,
  ScheduleBlock,
  ScheduleConflict,
  WorkloadSummary,
  PreliminarySurveyRuleType,
  CalendarRecommendationSignal,
} from "./types";
import {
  getHolidayCoverageWarning,
  isWorkingDay,
  parseDateOnly,
  workingDayDistance,
  workingDaysBefore,
} from "./calendar";
import { getFirstMeasurer } from "@/lib/utils/survey-code";

type DbClient = SupabaseClient<any, "public", any>;

function ensureTimeBudget(deadlineAt?: number) {
  if (deadlineAt && Date.now() >= deadlineAt) {
    throw new Error("RECOMMENDATION_TIME_BUDGET_EXCEEDED");
  }
}

interface TargetRow {
  id: number;
  code: string;
  year: number;
  period: string;
  business_name: string;
  address: string | null;
  measurement_date: string | null;
  daily_staff: unknown;
  measurer_id: number | null;
  preliminary_survey_rule_type: string;
  requires_field_preliminary_survey: boolean;
  updated_at: string;
}

export interface PlanView {
  id: string;
  measurement_target_business_id: number;
  status: string;
  responsible_user_id: number;
  experienced_user_id: number | null;
  visit_mode: string | null;
  recommended_date: string | null;
  confirmed_date: string | null;
  source_measurer_id: number | null;
  source_measurement_date: string | null;
  source_address: string | null;
  source_rule_type: string | null;
  source_target_updated_at: string;
  recommendation_reason: Record<string, unknown>;
  recommendation_score: number | null;
  warnings: string[];
  alternatives: Array<Record<string, unknown>>;
  review_reasons: string[];
  holiday_verification_status: string;
  holiday_verification_override_by: number | null;
  holiday_verification_override_at: string | null;
  holiday_verification_override_reason: string | null;
  holiday_calendar_status_snapshot: Record<string, unknown>;
  row_version: number;
  responsible_user_name?: string | null;
  experienced_user_name?: string | null;
  target?: TargetRow;
}

function validDate(value: unknown): string | null {
  const text = typeof value === "string" ? value.slice(0, 10) : "";
  return parseDateOnly(text) ? text : null;
}

export function getReferenceMeasurementDate(target: Pick<TargetRow, "daily_staff" | "measurement_date">): string | null {
  const dailyDates = Array.isArray(target.daily_staff)
    ? target.daily_staff
        .map((entry: any) => validDate(entry?.date))
        .filter((date): date is string => Boolean(date))
        .sort()
    : [];
  return dailyDates[0] || validDate(target.measurement_date);
}

function snapshotChanged(
  plan: PlanView,
  target: TargetRow,
  measurementDate: string | null,
  address: string,
): string[] {
  const reasons: string[] = [];
  if (Number(plan.source_measurer_id || 0) !== Number(target.measurer_id || 0)) {
    reasons.push("MEASURER_CHANGED");
  }
  if ((plan.source_measurement_date || null) !== measurementDate) {
    reasons.push("MEASUREMENT_DATE_CHANGED");
  }
  if ((plan.source_address || "").trim() !== address.trim()) {
    reasons.push("ADDRESS_CHANGED");
  }
  if (
    plan.source_rule_type != null &&
    plan.source_rule_type !== target.preliminary_survey_rule_type
  ) {
    reasons.push("RULE_TYPE_CHANGED");
  }
  return reasons;
}

function planToRecommendation(plan: PlanView): RecommendationResult {
  return {
    status: plan.status === "pending" ? "pending" : "recommended",
    reason:
      String(plan.recommendation_reason?.code || "") ||
      (plan.status === "pending" ? "RECOMMENDATION_PENDING" : "RECOMMENDATION_EXISTS"),
    recommendedDate: plan.recommended_date,
    responsibleUserId: plan.responsible_user_id,
    responsibleUserName: plan.responsible_user_name || "",
    experiencedUserId: plan.experienced_user_id,
    experiencedUserName: plan.experienced_user_name || null,
    visitMode: plan.visit_mode as RecommendationResult["visitMode"],
    score: plan.recommendation_score,
    warnings: plan.warnings || [],
    alternatives: (plan.alternatives || []) as any,
    reasonDetails: plan.recommendation_reason || {},
  };
}

async function loadTarget(supabase: DbClient, targetId: number): Promise<TargetRow> {
  const { data, error } = await supabase
    .from("measurement_target_business")
    .select(
      "id, code, year, period, business_name, address, measurement_date, daily_staff, measurer_id, preliminary_survey_rule_type, requires_field_preliminary_survey, updated_at",
    )
    .eq("id", targetId)
    .single();
  if (error || !data) throw new Error("TARGET_NOT_FOUND");
  const target = data as TargetRow;
  const { data: surveys } = await supabase
    .from("preliminary_survey")
    .select("measurer, measurement_date")
    .eq("code", target.code)
    .eq("year", target.year)
    .eq("period", target.period)
    .not("measurer", "is", null)
    .order("measurement_date", { ascending: true });
  const measurementDate = getReferenceMeasurementDate(target);
  const matchingSurvey = (surveys || []).find(
    (survey: any) => survey.measurement_date === measurementDate && getFirstMeasurer(survey.measurer),
  ) || (surveys || []).find((survey: any) => getFirstMeasurer(survey.measurer));
  const measurementMeasurerName = getFirstMeasurer(matchingSurvey?.measurer || "");
  if (!measurementMeasurerName) return target;

  const { data: measurementMeasurer } = await supabase
    .from("users")
    .select("id")
    .eq("name", measurementMeasurerName)
    .eq("job", "측정")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  return measurementMeasurer?.id
    ? { ...target, measurer_id: Number(measurementMeasurer.id) }
    : target;
}

function requiresPublicSampleMeasurerMatch(target: TargetRow, measurementDate: string | null) {
  return target.year === 2026 &&
    target.period.startsWith("하반기") &&
    Boolean(measurementDate && measurementDate >= "2026-07-01" && measurementDate <= "2026-07-31");
}

async function syncPlanSurveyorsToPreliminarySurvey(
  supabase: DbClient,
  target: TargetRow,
  plan: PlanView,
) {
  if (plan.status !== "recommended" && plan.status !== "confirmed") return;
  const participantIds = [plan.responsible_user_id, plan.experienced_user_id]
    .filter((id): id is number => Boolean(id));
  const { data: users, error: usersError } = await supabase
    .from("users")
    .select("id, name")
    .in("id", participantIds);
  if (usersError) throw new Error(`PLAN_SURVEYOR_SYNC_USER_QUERY_FAILED:${usersError.message}`);
  const nameById = new Map(
    (users || []).map((user: any) => [Number(user.id), String(user.name || "").trim()]),
  );
  const surveyorNames = participantIds.map((id) => nameById.get(id)).filter(Boolean).join(", ");
  if (!surveyorNames) return;
  const { error } = await supabase
    .from("preliminary_survey")
    .update({ preliminary_surveyor: surveyorNames })
    .eq("code", target.code)
    .eq("year", target.year)
    .eq("period", target.period);
  if (error) throw new Error(`PLAN_SURVEYOR_SYNC_FAILED:${error.message}`);
}

async function loadAddress(
  supabase: DbClient,
  target: TargetRow,
): Promise<string> {
  if (target.address?.trim()) return target.address.trim();
  const { data } = await supabase
    .from("business_info")
    .select("address1, address2")
    .eq("code", target.code)
    .maybeSingle();
  return [data?.address1, data?.address2].filter(Boolean).join(" ").trim();
}

async function loadUsers(supabase: DbClient): Promise<RecommendationUser[]> {
  const { data, error } = await supabase
    .from("users")
    .select(
      "id, name, job, is_active, is_preliminary_survey_experienced, is_preliminary_survey_support_assignable",
    );
  if (error) throw new Error(`USERS_QUERY_FAILED:${error.message}`);
  return (data || []) as RecommendationUser[];
}

function getScheduleEntries(row: any, userByName: Map<string, RecommendationUser>) {
  const entries: Array<{ date: string; userIds: number[] }> = [];
  const dailyStaff = Array.isArray(row.daily_staff) ? row.daily_staff : [];
  if (dailyStaff.length > 0) {
    for (const item of dailyStaff) {
      const date = validDate(item?.date);
      if (!date) continue;
      const ids = new Set<number>();
      if (Number(item?.measurer_id)) ids.add(Number(item.measurer_id));
      for (const collaborator of Array.isArray(item?.collaborators)
        ? item.collaborators
        : []) {
        const byName = userByName.get(String(collaborator).trim());
        if (byName) ids.add(byName.id);
      }
      entries.push({ date, userIds: [...ids] });
    }
  } else {
    const date = validDate(row.measurement_date);
    if (date) {
      const ids = new Set<number>();
      if (Number(row.measurer_id)) ids.add(Number(row.measurer_id));
      for (const name of String(row.collaborators || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)) {
        const byName = userByName.get(name);
        if (byName) ids.add(byName.id);
      }
      entries.push({ date, userIds: [...ids] });
    }
  }
  return entries;
}

async function loadMeasurementSchedules(
  supabase: DbClient,
  users: RecommendationUser[],
  targetId: number,
  targetRegion: string,
  minDate: string,
  maxDate: string,
): Promise<ScheduleConflict[]> {
  const userByName = new Map(users.map((user) => [user.name, user]));
  const [targetResponse, planResponse] = await Promise.all([
    supabase
      .from("measurement_target_business")
      .select(
        "id, business_name, address, measurement_date, daily_staff, measurer_id, collaborators",
      )
      .neq("id", targetId),
    supabase
      .from("preliminary_survey_plans")
      .select(
        "measurement_target_business_id, responsible_user_id, experienced_user_id, recommended_date, confirmed_date",
      )
      .neq("measurement_target_business_id", targetId)
      .in("status", ["recommended", "confirmed"]),
  ]);
  const { data: targets, error } = targetResponse;
  if (error) throw new Error(`MEASUREMENT_SCHEDULE_QUERY_FAILED:${error.message}`);
  if (planResponse.error) {
    throw new Error(`PRELIMINARY_SCHEDULE_QUERY_FAILED:${planResponse.error.message}`);
  }

  const result: ScheduleConflict[] = [];
  for (const row of targets || []) {
    const region = normalizeRegionKey(row.address);
    for (const entry of getScheduleEntries(row, userByName)) {
      if (entry.date < minDate || entry.date > maxDate) continue;
      for (const userId of entry.userIds) {
        result.push({
          userId,
          date: entry.date,
          kind: !region
            ? "unknown_region"
            : region === targetRegion
              ? "same_region"
              : "different_region",
          businessName: row.business_name,
        });
      }
    }
  }

  const targetById = new Map(
    (targets || []).map((row: any) => [Number(row.id), row]),
  );
  for (const plan of planResponse.data || []) {
    const date = validDate(plan.confirmed_date || plan.recommended_date);
    if (!date || date < minDate || date > maxDate) continue;
    const planTarget = targetById.get(
      Number(plan.measurement_target_business_id),
    ) as any;
    const region = normalizeRegionKey(planTarget?.address);
    for (const userId of [
      Number(plan.responsible_user_id),
      Number(plan.experienced_user_id),
    ].filter((id) => id > 0)) {
      result.push({
        userId,
        date,
        kind: !region
          ? "unknown_region"
          : region === targetRegion
            ? "same_region"
            : "different_region",
        businessName: planTarget?.business_name,
      });
    }
  }

  return result;
}

async function loadBlocks(
  supabase: DbClient,
  userIds: number[],
  minDate: string,
  maxDate: string,
): Promise<ScheduleBlock[]> {
  if (userIds.length === 0) return [];
  const { data, error } = await supabase
    .from("user_schedule_blocks")
    .select("user_id, start_date, end_date")
    .in("user_id", userIds)
    .lte("start_date", maxDate)
    .gte("end_date", minDate);
  if (error) throw new Error(`SCHEDULE_BLOCK_QUERY_FAILED:${error.message}`);
  return (data || []) as ScheduleBlock[];
}

async function loadWorkloads(
  supabase: DbClient,
  supportUserIds: number[],
  measurementDate: string,
): Promise<Map<number, WorkloadSummary>> {
  const result = new Map<number, WorkloadSummary>();
  supportUserIds.forEach((id) =>
    result.set(id, { halfYear: 0, recent30Days: 0, byDate: {} }),
  );
  if (supportUserIds.length === 0) return result;

  const year = Number(measurementDate.slice(0, 4));
  const month = Number(measurementDate.slice(5, 7));
  const halfStart = `${year}-${month <= 6 ? "01-01" : "07-01"}`;
  const halfEnd = `${year}-${month <= 6 ? "06-30" : "12-31"}`;
  const recentBoundary = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const { data, error } = await supabase
    .from("preliminary_survey_plans")
    .select("experienced_user_id, recommended_date")
    .eq("visit_mode", "joint_field_visit")
    .in("status", ["recommended", "confirmed"])
    .in("experienced_user_id", supportUserIds);
  if (error) throw new Error(`WORKLOAD_QUERY_FAILED:${error.message}`);

  for (const row of data || []) {
    const summary = result.get(Number(row.experienced_user_id));
    const date = validDate(row.recommended_date);
    if (!summary || !date) continue;
    if (date >= halfStart && date <= halfEnd) summary.halfYear += 1;
    if (date >= recentBoundary) summary.recent30Days += 1;
    summary.byDate[date] = (summary.byDate[date] || 0) + 1;
  }
  return result;
}

async function loadActivePlan(
  supabase: DbClient,
  targetId: number,
): Promise<PlanView | null> {
  const { data, error } = await supabase
    .from("preliminary_survey_plans")
    .select("*")
    .eq("measurement_target_business_id", targetId)
    .in("status", ["pending", "recommended", "confirmed", "needs_review"])
    .maybeSingle();
  if (error) throw new Error(`PLAN_QUERY_FAILED:${error.message}`);
  return (data as PlanView | null) || null;
}

async function latestPlanIsCancelled(
  supabase: DbClient,
  targetId: number,
): Promise<boolean> {
  const { data } = await supabase
    .from("preliminary_survey_plans")
    .select("status")
    .eq("measurement_target_business_id", targetId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.status === "cancelled";
}

async function markNeedsReview(
  supabase: DbClient,
  plan: PlanView,
  reasons: string[],
): Promise<PlanView> {
  const { data, error } = await supabase
    .from("preliminary_survey_plans")
    .update({ status: "needs_review", review_reasons: reasons })
    .eq("id", plan.id)
    .eq("row_version", plan.row_version)
    .select("*")
    .single();
  if (error) throw new Error(`PLAN_REVIEW_UPDATE_FAILED:${error.message}`);
  return data as PlanView;
}

async function persistResult(
  supabase: DbClient,
  target: TargetRow,
  address: string,
  measurementDate: string | null,
  result: RecommendationResult,
  actorUserId: number,
): Promise<PlanView | null> {
  if (!target.measurer_id) return null;
  const { data, error } = await supabase.rpc(
    "persist_preliminary_survey_recommendation",
    {
      p_target_id: target.id,
      p_expected_target_updated_at: target.updated_at,
      p_status: result.status,
      p_responsible_user_id: result.responsibleUserId,
      p_experienced_user_id: result.experiencedUserId,
      p_visit_mode: result.visitMode,
      p_recommended_date: result.recommendedDate,
      p_source_measurer_id: target.measurer_id,
      p_source_measurement_date: measurementDate,
      p_source_address: address,
      p_recommendation_reason: {
        code: result.reason,
        ...result.reasonDetails,
      },
      p_recommendation_score: result.score,
      p_warnings: result.warnings,
      p_alternatives: result.alternatives,
      p_actor_user_id: actorUserId,
    },
  );
  if (error) {
    if (error.message?.includes("PLAN_SOURCE_CHANGED")) {
      throw new Error("PLAN_SOURCE_CHANGED");
    }
    throw new Error(`PLAN_SAVE_FAILED:${error.message}`);
  }
  const savedPlan = ((data || [])[0] as PlanView | undefined) || null;
  if (savedPlan) await syncPlanSurveyorsToPreliminarySurvey(supabase, target, savedPlan);
  return savedPlan;
}

export async function recommendAndPersistPreliminarySurvey(
  supabase: DbClient,
  options: {
    targetId: number;
    actorUserId: number;
    manual: boolean;
    replaceConfirmed?: boolean;
    deadlineAt?: number;
    calendarSignals?: CalendarRecommendationSignal[];
    calendarStatus?: "available" | "unavailable" | "not_applicable";
    calendarCheckedAt?: string;
  },
): Promise<{ result: RecommendationResult; plan: PlanView | null }> {
  const target = await loadTarget(supabase, options.targetId);
  ensureTimeBudget(options.deadlineAt);
  const measurementDate = getReferenceMeasurementDate(target);
  const address = await loadAddress(supabase, target);
  const activePlan = await loadActivePlan(supabase, target.id);
  ensureTimeBudget(options.deadlineAt);

  if (activePlan && !options.manual) {
    if (activePlan.status === "pending") {
      // 누락 조건이 새로 충족되었을 수 있으므로 아래에서 다시 계산한다.
    } else {
      const reasons = snapshotChanged(activePlan, target, measurementDate, address);
      if (reasons.length > 0 && ["recommended", "confirmed"].includes(activePlan.status)) {
        const reviewed = await markNeedsReview(supabase, activePlan, reasons);
        return { result: planToRecommendation(reviewed), plan: reviewed };
      }
      return { result: planToRecommendation(activePlan), plan: activePlan };
    }
  }

  const isExisting = target.preliminary_survey_rule_type === "existing";
  if (
    !isExisting &&
    (!isNewPreliminarySurveyRule(target.preliminary_survey_rule_type) ||
      !target.requires_field_preliminary_survey)
  ) {
    throw new Error("TARGET_NOT_SUPPORTED_PRELIMINARY_SURVEY");
  }

  const users = await loadUsers(supabase);
  const responsible = users.find((user) => user.id === Number(target.measurer_id));
  ensureTimeBudget(options.deadlineAt);

  if (!activePlan && !options.manual && (await latestPlanIsCancelled(supabase, target.id))) {
    throw new Error("PLAN_CANCELLED_MANUAL_RESTART_REQUIRED");
  }

  if (activePlan?.status === "confirmed" && options.manual) {
    if (!options.replaceConfirmed) throw new Error("CONFIRMED_PLAN_REQUIRES_CANCEL");
    const { error } = await supabase.rpc("cancel_preliminary_survey_plan", {
      p_plan_id: activePlan.id,
      p_expected_row_version: activePlan.row_version,
    });
    if (error) throw new Error(`PLAN_CANCEL_FAILED:${error.message}`);
  }

  const pendingReason = !target.measurer_id
    ? "MEASURER_REQUIRED"
    : !measurementDate
      ? "MEASUREMENT_DATE_REQUIRED"
      : !address
        ? "ADDRESS_REQUIRED"
        : !responsible
          ? "RESPONSIBLE_USER_NOT_FOUND"
          : null;

  if (pendingReason || !responsible || !measurementDate || !address) {
    const result: RecommendationResult = {
      status: "pending",
      reason: pendingReason || "RECOMMENDATION_PENDING",
      recommendedDate: null,
      responsibleUserId: Number(target.measurer_id || 0),
      responsibleUserName: responsible?.name || "",
      experiencedUserId: null,
      experiencedUserName: null,
      visitMode: null,
      score: null,
      warnings: [],
      alternatives: [],
      reasonDetails: {},
    };
    const plan = await persistResult(
      supabase,
      target,
      address,
      measurementDate,
      result,
      options.actorUserId,
    );
    return { result, plan };
  }

  const targetRegion = normalizeRegionKey(address);
  if (!targetRegion) {
    const result: RecommendationResult = {
      status: "pending",
      reason: "ADDRESS_REGION_UNAVAILABLE",
      recommendedDate: null,
      responsibleUserId: responsible.id,
      responsibleUserName: responsible.name,
      experiencedUserId: null,
      experiencedUserName: null,
      visitMode: null,
      score: null,
      warnings: [],
      alternatives: [],
      reasonDetails: {},
    };
    const plan = await persistResult(
      supabase,
      target,
      address,
      measurementDate,
      result,
      options.actorUserId,
    );
    return { result, plan };
  }

  const supports = isExisting ? [] : users.filter(
    (user) =>
      user.is_active &&
      user.job === "측정" &&
      user.is_preliminary_survey_experienced &&
      user.is_preliminary_survey_support_assignable,
  );
  const candidateDates = workingDaysBefore(measurementDate, 30);
  const minDate = candidateDates[candidateDates.length - 1]?.date || measurementDate;
  const maxDate = candidateDates[0]?.date || measurementDate;
  const strictPublicSampleMeasurerMatch = requiresPublicSampleMeasurerMatch(
    target,
    measurementDate,
  );
  const fallbackResponsibles = strictPublicSampleMeasurerMatch ? [] : users.filter(
    (user) => user.is_active && user.job === "측정" && user.id !== responsible.id,
  );
  const participantIds = [
    ...new Set([
      responsible.id,
      ...fallbackResponsibles.map((user) => user.id),
      ...supports.map((user) => user.id),
    ]),
  ];
  const [blocks, schedules, workloads] = await Promise.all([
    loadBlocks(supabase, participantIds, minDate, maxDate),
    loadMeasurementSchedules(
      supabase,
      users,
      target.id,
      targetRegion,
      minDate,
      maxDate,
    ),
    loadWorkloads(supabase, supports.map((user) => user.id), measurementDate),
  ]);
  ensureTimeBudget(options.deadlineAt);

  let result = recommendPreliminarySurvey({
    ruleType: target.preliminary_survey_rule_type as PreliminarySurveyRuleType,
    measurementDate,
    targetRegion,
    responsible,
    supportCandidates: supports,
    blocks,
    schedules,
    workloads,
    calendarSignals: options.calendarSignals,
  });
  if (
    result.status === "pending" &&
    [
      "NO_AVAILABLE_DATE",
      "NO_AVAILABLE_EXPERIENCED_USER",
      "RESPONSIBLE_USER_UNAVAILABLE",
    ].includes(result.reason)
  ) {
    const fallbackResults = fallbackResponsibles
      .map((candidate) => recommendPreliminarySurvey({
        ruleType: target.preliminary_survey_rule_type as PreliminarySurveyRuleType,
        measurementDate,
        targetRegion,
        responsible: candidate,
        supportCandidates: supports,
        blocks,
        schedules,
        workloads,
        calendarSignals: options.calendarSignals,
      }))
      .filter((candidate) => candidate.status === "recommended")
      .sort(
        (a, b) =>
          Number(a.score ?? Number.MAX_SAFE_INTEGER) -
            Number(b.score ?? Number.MAX_SAFE_INTEGER) ||
          a.responsibleUserId - b.responsibleUserId,
      );
    if (fallbackResults[0]) {
      result = fallbackResults[0];
      result.warnings = [
        ...new Set([...result.warnings, "RESPONSIBLE_DIFFERS_FROM_MEASURER"]),
      ];
      result.reasonDetails = {
        ...result.reasonDetails,
        fallbackFromMeasurerId: responsible.id,
        fallbackFromMeasurerName: responsible.name,
        responsibleFallbackApplied: true,
      };
    }
  }
  if (options.calendarStatus === "unavailable") {
    result.warnings = [...new Set([...result.warnings, "GOOGLE_CALENDAR_DATA_UNAVAILABLE"])];
  }
  result.reasonDetails.calendarStatus = options.calendarStatus || "not_checked";
  result.reasonDetails.calendarCheckedAt = options.calendarCheckedAt || null;
  result.reasonDetails.publicSampleMeasurerMatchRequired = strictPublicSampleMeasurerMatch;
  ensureTimeBudget(options.deadlineAt);
  const latestTarget = await loadTarget(supabase, target.id);
  if (latestTarget.updated_at !== target.updated_at) throw new Error("PLAN_SOURCE_CHANGED");
  ensureTimeBudget(options.deadlineAt);
  const plan = await persistResult(
    supabase,
    target,
    address,
    measurementDate,
    result,
    options.actorUserId,
  );
  return { result, plan };
}

export async function refreshPlanReview(
  supabase: DbClient,
  plan: PlanView,
): Promise<PlanView> {
  if (!["recommended", "confirmed"].includes(plan.status)) return plan;
  const target = await loadTarget(supabase, plan.measurement_target_business_id);
  const measurementDate = getReferenceMeasurementDate(target);
  const address = await loadAddress(supabase, target);
  const reasons = snapshotChanged(plan, target, measurementDate, address);
  const planDate = plan.confirmed_date || plan.recommended_date;

  const participantIds = [
    plan.responsible_user_id,
    plan.experienced_user_id,
  ].filter((id): id is number => Boolean(id));
  const { data: users } = await supabase
    .from("users")
    .select(
      "id, is_active, job, is_preliminary_survey_experienced, is_preliminary_survey_support_assignable",
    )
    .in("id", participantIds);
  const responsible = users?.find((user: any) => user.id === plan.responsible_user_id);
  const experienced = users?.find((user: any) => user.id === plan.experienced_user_id);
  if (!responsible?.is_active || responsible?.job !== "측정") {
    reasons.push("RESPONSIBLE_USER_UNAVAILABLE");
  }
  if (
    plan.visit_mode === "experienced_solo_visit" &&
    !responsible?.is_preliminary_survey_experienced
  ) {
    reasons.push("RESPONSIBLE_EXPERIENCE_CHANGED");
  }
  if (
    plan.visit_mode === "joint_field_visit" &&
    (!experienced?.is_active ||
      !experienced?.is_preliminary_survey_experienced ||
      !experienced?.is_preliminary_survey_support_assignable)
  ) {
    reasons.push("EXPERIENCED_USER_UNAVAILABLE");
  }

  if (planDate) {
    const blocks = await loadBlocks(supabase, participantIds, planDate, planDate);
    if (blocks.length > 0) reasons.push("USER_SCHEDULE_BLOCK_CONFLICT");
    const targetRegion = normalizeRegionKey(address);
    if (targetRegion) {
      const allUsers = await loadUsers(supabase);
      const schedules = await loadMeasurementSchedules(
        supabase,
        allUsers,
        target.id,
        targetRegion,
        planDate,
        planDate,
      );
      if (
        schedules.some(
          (schedule) =>
            participantIds.includes(schedule.userId) &&
            schedule.kind === "different_region",
        )
      ) {
        reasons.push("DIFFERENT_REGION_MEASUREMENT_CONFLICT");
      }
    }
    const distance = measurementDate
      ? workingDayDistance(planDate, measurementDate)
      : null;
    if (distance === null || distance < 1 || distance > 30) {
      reasons.push("WORKING_DAY_RANGE_CHANGED");
    }
  }

  return reasons.length > 0
    ? markNeedsReview(supabase, plan, [...new Set(reasons)])
    : plan;
}

export async function validatePlanConfirmation(
  supabase: DbClient,
  plan: PlanView,
  confirmedDate: string,
): Promise<{ warnings: string[] }> {
  if (!parseDateOnly(confirmedDate)) throw new Error("INVALID_CONFIRMED_DATE");
  if (!isWorkingDay(confirmedDate)) throw new Error("NON_WORKING_DAY");

  const reviewed = await refreshPlanReview(supabase, plan);
  if (reviewed.status === "needs_review") throw new Error("PLAN_SOURCE_CHANGED");

  const target = await loadTarget(supabase, plan.measurement_target_business_id);
  const measurementDate = getReferenceMeasurementDate(target);
  const distance = measurementDate
    ? workingDayDistance(confirmedDate, measurementDate)
    : null;
  if (distance === null || distance < 1 || distance > 30) {
    throw new Error("CONFIRMED_DATE_OUT_OF_RANGE");
  }

  const users = await loadUsers(supabase);
  const address = await loadAddress(supabase, target);
  const region = normalizeRegionKey(address);
  if (!region) throw new Error("ADDRESS_REGION_UNAVAILABLE");
  const participantIds = [
    plan.responsible_user_id,
    plan.experienced_user_id,
  ].filter((id): id is number => Boolean(id));
  const [blocks, schedules] = await Promise.all([
    loadBlocks(supabase, participantIds, confirmedDate, confirmedDate),
    loadMeasurementSchedules(
      supabase,
      users,
      target.id,
      region,
      confirmedDate,
      confirmedDate,
    ),
  ]);
  if (blocks.length > 0) throw new Error("USER_SCHEDULE_BLOCK_CONFLICT");
  const participantSchedules = schedules.filter((item) =>
    participantIds.includes(item.userId),
  );
  if (participantSchedules.some((item) => item.kind === "different_region")) {
    throw new Error("DIFFERENT_REGION_MEASUREMENT_CONFLICT");
  }

  const warnings: string[] = [];
  if (participantSchedules.some((item) => item.kind === "same_region")) {
    warnings.push("SAME_REGION_SCHEDULE_TIME_CHECK_REQUIRED");
  }
  if (participantSchedules.some((item) => item.kind === "unknown_region")) {
    warnings.push("UNKNOWN_REGION_SCHEDULE_CHECK_REQUIRED");
  }
  const holidayWarning = getHolidayCoverageWarning(confirmedDate);
  if (holidayWarning) warnings.push(holidayWarning);
  return { warnings };
}

export async function applyManualPlanSelection(
  supabase: DbClient,
  plan: PlanView,
  options: {
    recommendedDate: string;
    responsibleUserId: number;
    experiencedUserId?: number | null;
    expectedRowVersion: number;
    calendarSignals?: CalendarRecommendationSignal[];
    calendarStatus?: "available" | "unavailable" | "not_applicable";
    calendarCheckedAt?: string;
  },
): Promise<{ plan: PlanView; warnings: string[] }> {
  if (plan.status === "confirmed") {
    throw new Error("CONFIRMED_PLAN_REQUIRES_CANCEL");
  }
  if (!parseDateOnly(options.recommendedDate)) throw new Error("INVALID_RECOMMENDED_DATE");
  if (!isWorkingDay(options.recommendedDate)) throw new Error("NON_WORKING_DAY");
  if (!Number.isInteger(options.responsibleUserId)) {
    throw new Error("INVALID_RESPONSIBLE_USER_ID");
  }
  const selectedExperiencedUserId = options.experiencedUserId || null;
  const storedOptions = [
    ...(plan.recommended_date ? [{
      date: plan.recommended_date,
      responsibleUserId: Number(plan.responsible_user_id),
      experiencedUserId: plan.experienced_user_id || null,
    }] : []),
    ...((plan.alternatives || []).map((alternative: any) => ({
      date: String(alternative.date || ""),
      responsibleUserId: Number(
        alternative.responsibleUserId || plan.responsible_user_id,
      ),
      experiencedUserId: alternative.experiencedUserId || null,
    }))),
  ];
  if (!storedOptions.some((option) =>
    option.date === options.recommendedDate &&
    option.responsibleUserId === options.responsibleUserId &&
    Number(option.experiencedUserId || 0) === Number(selectedExperiencedUserId || 0)
  )) {
    throw new Error("RECOMMENDATION_OPTION_NOT_ALLOWED");
  }

  const target = await loadTarget(supabase, plan.measurement_target_business_id);
  const measurementDate = getReferenceMeasurementDate(target);
  const distance = measurementDate
    ? workingDayDistance(options.recommendedDate, measurementDate)
    : null;
  if (distance === null || distance < 1 || distance > 30) {
    throw new Error("RECOMMENDED_DATE_OUT_OF_RANGE");
  }

  const users = await loadUsers(supabase);
  const selectedUser = users.find((user) => user.id === options.responsibleUserId);
  if (!selectedUser || !selectedUser.is_active || selectedUser.job !== "측정") {
    throw new Error("RESPONSIBLE_USER_UNAVAILABLE");
  }
  if (
    requiresPublicSampleMeasurerMatch(target, measurementDate) &&
    selectedUser.id !== Number(target.measurer_id)
  ) {
    throw new Error("JULY_2026_PRELIMINARY_SURVEYOR_MUST_MATCH_MEASURER");
  }
  const isExisting = target.preliminary_survey_rule_type === "existing";
  const requestedExperiencedUser = options.experiencedUserId
    ? users.find((user) => user.id === options.experiencedUserId)
    : null;
  const experiencedUser = isExisting || selectedUser.is_preliminary_survey_experienced
    ? null
    : requestedExperiencedUser;
  if (!isExisting && !selectedUser.is_preliminary_survey_experienced && !experiencedUser) {
    throw new Error("MANUAL_NOVICE_REQUIRES_EXPERIENCED_COMPANION");
  }
  if (
    experiencedUser &&
    (
      !experiencedUser.is_active ||
      experiencedUser.job !== "측정" ||
      !experiencedUser.is_preliminary_survey_experienced ||
      !experiencedUser.is_preliminary_survey_support_assignable ||
      experiencedUser.id === selectedUser.id
    )
  ) {
    throw new Error("EXPERIENCED_COMPANION_UNAVAILABLE");
  }
  const participantIds = [selectedUser.id, experiencedUser?.id].filter(
    (value): value is number => value !== undefined,
  );
  if (
    options.calendarSignals?.some(
      (signal) =>
        participantIds.includes(signal.userId) &&
        signal.date === options.recommendedDate &&
        signal.kind === "occupied",
    )
  ) {
    throw new Error("GOOGLE_CALENDAR_PRELIMINARY_CONFLICT");
  }

  const address = await loadAddress(supabase, target);
  const region = normalizeRegionKey(address);
  if (!region) throw new Error("ADDRESS_REGION_UNAVAILABLE");
  const [blocks, schedules] = await Promise.all([
    loadBlocks(
      supabase,
      participantIds,
      options.recommendedDate,
      options.recommendedDate,
    ),
    loadMeasurementSchedules(
      supabase,
      users,
      target.id,
      region,
      options.recommendedDate,
      options.recommendedDate,
    ),
  ]);
  if (blocks.length > 0) throw new Error("USER_SCHEDULE_BLOCK_CONFLICT");
  const selectedSchedules = schedules.filter(
    (schedule) => participantIds.includes(schedule.userId),
  );
  if (selectedSchedules.some((schedule) => schedule.kind === "different_region")) {
    throw new Error("DIFFERENT_REGION_MEASUREMENT_CONFLICT");
  }

  const warnings: string[] = [];
  if (selectedUser.id !== Number(target.measurer_id)) {
    warnings.push("RESPONSIBLE_DIFFERS_FROM_MEASURER");
  }
  if (selectedSchedules.some((schedule) => schedule.kind === "same_region")) {
    warnings.push("SAME_REGION_SCHEDULE_TIME_CHECK_REQUIRED");
  }
  if (selectedSchedules.some((schedule) => schedule.kind === "unknown_region")) {
    warnings.push("UNKNOWN_REGION_SCHEDULE_CHECK_REQUIRED");
  }
  const holidayWarning = getHolidayCoverageWarning(options.recommendedDate);
  if (holidayWarning) warnings.push(holidayWarning);
  if (options.calendarStatus === "unavailable") {
    warnings.push("GOOGLE_CALENDAR_DATA_UNAVAILABLE");
  }
  const calendarPreference = options.calendarSignals?.find(
    (signal) =>
      participantIds.includes(signal.userId) &&
      signal.date === options.recommendedDate &&
      signal.kind === "preferred",
  );

  const { data, error } = await supabase
    .from("preliminary_survey_plans")
    .update({
      responsible_user_id: selectedUser.id,
      experienced_user_id: experiencedUser?.id || null,
      visit_mode: isExisting
        ? "existing_field_visit"
        : experiencedUser
          ? "joint_field_visit"
          : "experienced_solo_visit",
      recommended_date: options.recommendedDate,
      confirmed_date: null,
      status: "recommended",
      source_measurer_id: target.measurer_id,
      source_measurement_date: measurementDate,
      source_address: address,
      source_rule_type: target.preliminary_survey_rule_type,
      source_target_updated_at: target.updated_at,
      recommendation_reason: {
        code: "MANUAL_SELECTION_APPLIED",
        selectedByUser: true,
        sourceMeasurerPreferred: selectedUser.id === Number(target.measurer_id),
        phoneSurveyAllowed: isExisting,
        recommendationAssumption: isExisting ? "field_visit" : "field_visit_required",
        calendarStatus: options.calendarStatus || "not_checked",
        calendarCheckedAt: options.calendarCheckedAt || null,
        calendarPreferenceApplied: Boolean(calendarPreference),
        calendarSignalSnapshot: calendarPreference ? [calendarPreference] : [],
      },
      recommendation_score: null,
      warnings,
      alternatives: [],
      review_reasons: [],
      holiday_verification_status: holidayWarning ? "incomplete" : "verified",
      holiday_verification_override_by: null,
      holiday_verification_override_at: null,
      holiday_verification_override_reason: null,
      holiday_calendar_status_snapshot: {
        reviewedYearFrom: 2025,
        reviewedYearTo: 2027,
        source: "application_snapshot",
        status: holidayWarning ? "incomplete" : "verified",
      },
      confirmed_by: null,
      confirmed_at: null,
    })
    .eq("id", plan.id)
    .eq("row_version", options.expectedRowVersion)
    .neq("status", "confirmed")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`PLAN_MANUAL_UPDATE_FAILED:${error.message}`);
  if (!data) throw new Error("PLAN_VERSION_CONFLICT");
  await syncPlanSurveyorsToPreliminarySurvey(supabase, target, data as PlanView);
  return { plan: data as PlanView, warnings };
}
