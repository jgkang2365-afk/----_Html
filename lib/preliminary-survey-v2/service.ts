import type { SupabaseClient } from "@supabase/supabase-js";
import { collectMeasurementStaffNames } from "@/lib/business/link-measurer";
import { classifyMeasurementJournalBusiness, type MeasurementJournalClassificationRow } from "./classification";
import { buildScheduleBlockKeys } from "./availability";
import { recommendBatch } from "./engine";
import { validateManualPlanHardRules } from "./manual-validation";
import {
  PROCESS_CHANGED_POLICY_OFF,
  shouldApplyProcessChangedPolicy,
  targetChangeRecommendationPolicy,
  type ProcessChangedPolicySettings,
} from "./policy";
import { createRouteMetrics } from "./route-metrics";
import { surveyMethodForKind, type ExistingAssignment, type RecommendationResult, type RouteMetrics, type SurveyTarget, type SurveyUser } from "./types";

type Client = SupabaseClient<any, "public", any>;

function names(value: unknown): string[] {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

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
    "id, code, year, period, business_name, address, measurement_date, measurer_id, link_measurer_id, created_at, business_type, process_changed, preliminary_survey_rule_type",
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
  // 예비조사 responsible는 반드시 연계측정자(link_measurer_id)다.
  // link_measurer_id가 없으면 연계측정자 미확정 상태로 보고 자동 추천을 진행하지 않는다.
  // 보고서 담당자(measurer_id)는 responsible로 대체하지 않는다.
  const responsibleId = targetRow.link_measurer_id;
  const responsible = responsibleId == null
    ? undefined
    : users.find((user) => user.id === Number(responsibleId));
  if (!responsible) throw new Error("LINK_MEASURER_REQUIRED");
  const classification = classifyMeasurementJournalBusiness({
    code: targetRow.code, year: Number(targetRow.year), period: targetRow.period,
    business_type: targetRow.business_type,
    preliminary_survey_rule_type: targetRow.preliminary_survey_rule_type,
  }, (journalRows ?? []) as MeasurementJournalClassificationRow[]);
  const target: SurveyTarget = {
    id: Number(targetRow.id), code: targetRow.code, name: targetRow.business_name,
    kind: classification.kind, measurementDate: targetRow.measurement_date, responsible,
    address: targetRow.address, region: regionFromAddress(targetRow.address), coordinate: coordinateFromRow(infoRow),
    createdAt: targetRow.created_at,
    businessType: targetRow.business_type,
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
  measurementDateFrom?: string;
  measurementDateTo?: string;
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

/** SELECT 전용 계산 경로. 이 함수는 insert/update/upsert/rpc를 호출하지 않는다. */
export async function calculateV2Recommendations(
  supabase: Client,
  options: CalculationOptions = {},
): Promise<CalculationOutput> {
  let targetQuery = supabase.from("measurement_target_business").select(
    "id, code, year, period, business_name, address, measurement_date, measurer_id, link_measurer_id, created_at, business_type, process_changed, preliminary_survey_rule_type",
  ).not("measurement_date", "is", null);
  if (options.targetIds?.length) targetQuery = targetQuery.in("id", options.targetIds);
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
  const userById = new Map(users.map((user) => [user.id, user]));
  const userIdByName = new Map(users.map((user) => [user.name, user.id]));
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
  const targets = (rawTargets ?? []).flatMap((row: any) => {
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
    // 예비조사 responsible는 반드시 연계측정자(link_measurer_id)다. 보고서 담당자(measurer_id)는 대체하지 않는다.
    const responsible = row.link_measurer_id == null
      ? undefined
      : userById.get(Number(row.link_measurer_id));
    const fields = [
      !row.measurement_date && "measurement_date",
      !responsible && "link_measurer",
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
      measurementDate: row.measurement_date, responsible: responsible!, address: row.address,
      region: regionFromAddress(row.address), coordinate, createdAt: row.created_at, classificationSource,
      businessType: row.business_type,
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

  const candidateDates = targets.flatMap((target) => [target.measurementDate]);
  const earliest = candidateDates.sort()[0];
  const latest = candidateDates.sort().at(-1);
  const { data: blocks, error: blockError } = earliest && latest
    ? await supabase.from("user_schedule_blocks").select("user_id, start_date, end_date").lte("start_date", latest).gte("end_date", "2024-01-01")
    : { data: [], error: null };
  if (blockError) throw new Error(`V2_BLOCK_QUERY_FAILED:${blockError.message}`);

  // 실제 측정 일정은 candidate가 될 수 있는 충분히 넓은 범위를 읽는다.
  const { data: measurementRows, error: scheduleError } = earliest && latest
    ? await supabase.from("preliminary_survey").select("measurement_date, measurer, actual_measurer, report_writer")
        .gte("measurement_date", "2024-01-01").lte("measurement_date", latest)
    : { data: [], error: null };
  if (scheduleError) throw new Error(`V2_MEASUREMENT_SCHEDULE_QUERY_FAILED:${scheduleError.message}`);
  const blockedKeys = buildScheduleBlockKeys(blocks ?? []);
  for (const schedule of measurementRows ?? []) {
    const participantNames = new Set([
      ...names(schedule.measurer), ...names(schedule.actual_measurer), ...names(schedule.report_writer),
    ]);
    for (const name of participantNames) {
      const userId = userIdByName.get(name);
      if (userId) blockedKeys.add(`${userId}:${schedule.measurement_date}`);
    }
  }

  const { data: queriedPlanRows, error: planError } = await supabase.from("preliminary_survey_v2_plans").select(
    "measurement_target_business_id, recommended_date, participant_user_ids, responsible_user_id, experienced_reviewer_id, status, source_rule_type",
  ).eq("status", "recommended");
  const v2TableMissing = planError?.code === "42P01" || planError?.code === "PGRST205";
  if (planError && !v2TableMissing) throw new Error(`V2_PLAN_QUERY_FAILED:${planError.message}`);
  const planRows = v2TableMissing ? [] : (queriedPlanRows ?? []);
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const existingAssignments: ExistingAssignment[] = (planRows ?? []).flatMap((plan: any) => {
    if (!plan.recommended_date || options.targetIds?.includes(Number(plan.measurement_target_business_id))) return [];
    const target = targetById.get(Number(plan.measurement_target_business_id));
    return [{
      targetId: Number(plan.measurement_target_business_id), businessCode: target?.code ?? String(plan.measurement_target_business_id),
      kind: target?.kind ?? (plan.source_rule_type === "new" ? "new" : "existing"), date: plan.recommended_date,
      participants: Array.isArray(plan.participant_user_ids) ? plan.participant_user_ids.map(Number) : [],
      responsibleUserId: Number(plan.responsible_user_id), experiencedReviewerId: plan.experienced_reviewer_id ? Number(plan.experienced_reviewer_id) : null,
      coordinate: target?.coordinate ?? null, region: target?.region ?? null,
    }];
  });

  const results = await recommendBatch({
    targets, experiencedUsers: users.filter((user) => user.experienced && user.active !== false), existingAssignments,
    availability: { isBlocked: (userId, date) => blockedKeys.has(`${userId}:${date}`) },
    routes: options.routeMetrics ?? createRouteMetrics(options.allowExternalRoutes === false ? "" : undefined),
  });
  return { targets, results, missing, blockedKeys: [...blockedKeys] };
}

export async function persistV2Recommendations(supabase: Client, output: CalculationOutput) {
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
      plan_origin: "automatic",
      source_measurement_date: target.measurementDate,
      source_responsible_user_id: target.responsible.id,
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
  const { data, error } = await supabase.rpc("persist_preliminary_survey_v2_plan_batch", { p_plans: payload });
  if (error) throw new Error(`V2_PLAN_SAVE_FAILED:${error.message}`);
  return Array.isArray(data) ? data : [];
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
  | "confirmed"      // sequence_number 부여 확정 → 자동 변경 금지
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
 * steady-state: 측정일 + 실제 측정자만 있으면 V2 plan을 자동 생성/재추천한다.
 *
 * - 보고서 담당자(measurer_id)는 실제 측정자 판단·예비조사자 추천에 사용하지 않는다.
 * - 예·측 후보는 "추천 예비조사자 ∩ 실제 측정자"로 계산한다.
 * - sequence_number 부여(확정) 후에는 자동 변경하지 않는다.
 * - 사용자가 수동 확정한 plan(plan_origin='manual')은 자동으로 덮어쓰지 않는다.
 * - upsert(measurement_target_business_id unique)로 중복 plan이 생기지 않는다.
 */
export async function ensureV2PlanForTarget(supabase: Client, targetId: number): Promise<SteadyStatePlanResult> {
  const { data: target, error: targetError } = await supabase.from("measurement_target_business")
    .select("id, code, year, period, business_name, address, measurement_date, daily_staff, collaborators, measurer_id, link_measurer_id, business_type, process_changed, preliminary_survey_rule_type, created_at")
    .eq("id", targetId).single();
  if (targetError || !target) return { action: "blocked", reason: "TARGET_NOT_FOUND" };

  // 확정(sequence_number 부여) 보호
  const basePeriod = String(target.period).trim().replace("(수시)", "");
  const { data: confirmedJournal } = await supabase.from("measurement_journal")
    .select("id").eq("code", target.code).eq("measurement_year", Number(target.year))
    .like("measurement_period", `${basePeriod}%`).not("sequence_number", "is", null).limit(1).maybeSingle();
  if (confirmedJournal) return { action: "confirmed", reason: "SEQUENCE_NUMBER_CONFIRMED" };

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

  const { data: saved, error: persistError } = await supabase.rpc("persist_preliminary_survey_v2_plan_batch", { p_plans: payload });
  if (persistError) return { action: "blocked", reason: `V2_PERSIST_FAILED:${persistError.message}` };
  const plan = Array.isArray(saved) ? saved[0] : saved;
  if (!plan) return { action: "blocked", reason: "V2_PERSIST_EMPTY" };

  const staffSet = new Set(staff);
  const linkCandidates = (plan.participant_names || [] as unknown[])
    .map((name: unknown) => String(name))
    .filter((name: string) => staffSet.has(name));

  const action: SteadyStatePlanAction = result.status === "manual_required"
    ? "manual_required"
    : existingPlan ? "replaced" : "created";
  return {
    action,
    plan,
    linkCandidates,
    reason: result.status === "manual_required" ? "NO_AVAILABLE_DATE_THROUGH_MINUS_3" : null,
    message: result.status === "manual_required"
      ? "측정일 기준 -3일까지 가능한 예비조사 추천일이 없습니다. 예비조사일을 수동으로 지정해 주세요."
      : action === "replaced"
        ? "측정일/실제 측정자 변경으로 예비조사 계획을 자동 재추천했습니다."
        : "예비조사 계획을 자동 생성했습니다.",
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
