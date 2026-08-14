import type { SupabaseClient } from "@supabase/supabase-js";
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
    "id, code, year, period, business_name, address, measurement_date, measurer_id, created_at, business_type, process_changed, preliminary_survey_rule_type",
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
  const responsible = users.find((user) => user.id === Number(targetRow.measurer_id));
  if (!responsible) throw new Error("RESPONSIBLE_USER_MISSING");
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
    "id, code, year, period, business_name, address, measurement_date, measurer_id, created_at, business_type, process_changed, preliminary_survey_rule_type",
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
    const responsible = userById.get(Number(row.measurer_id));
    const fields = [!row.measurement_date && "measurement_date", !responsible && "responsible_user"].filter(Boolean) as string[];
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
  const plans = [];
  for (const result of output.results) {
    const target = targetById.get(result.targetId);
    if (!target) continue;
    const { data, error } = await supabase.rpc("persist_preliminary_survey_v2_plan", {
      p_target_id: target.id,
      p_recommended_date: result.date,
      p_responsible_user_id: result.responsible.id,
      p_experienced_reviewer_id: result.experiencedReviewer?.id ?? null,
      p_participant_user_ids: result.participants.map((user) => user.id),
      p_participant_names: result.participants.map((user) => user.name),
      p_status: result.status,
      p_plan_origin: "automatic",
      p_source_measurement_date: target.measurementDate,
      p_source_responsible_user_id: target.responsible.id,
      p_source_rule_type: target.kind,
      p_survey_method: result.surveyMethod,
      p_recommendation_reason: { reason: result.reason, evidence: result.evidence },
      p_route_evidence: {
        ...(result.evidence.route ?? {}),
        ...(result.evidence.sameDayRoute ?? {}),
        rejectedSameDayRoutes: result.evidence.rejectedSameDayRoutes,
      },
      p_warnings: result.evidence.warnings,
    });
    if (error) throw new Error(`V2_PLAN_SAVE_FAILED:${error.message}`);
    plans.push(Array.isArray(data) ? data[0] : data);
  }
  return plans;
}

export async function recommendAndPersistV2(supabase: Client, targetIds: number[]) {
  const output = await calculateV2Recommendations(supabase, { targetIds });
  const plans = await persistV2Recommendations(supabase, output);
  return { ...output, plans };
}

export async function reconcileV2AfterTargetChange(
  supabase: Client,
  targetId: number,
  changes: { responsibleChanged: boolean; measurementDateChanged: boolean },
) {
  const { data: plan } = await supabase.from("preliminary_survey_v2_plans").select("*")
    .eq("measurement_target_business_id", targetId).maybeSingle();
  if (!plan) return null;
  if (changes.responsibleChanged) {
    const result = await recommendAndPersistV2(supabase, [targetId]);
    return { message: "보고서 담당자 변경으로 예비조사 일정 및 조사자가 자동 재추천되었습니다.", result };
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
