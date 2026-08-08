import type { SupabaseClient } from "@supabase/supabase-js";
import { recommendBatch } from "./engine";
import { targetChangeRecommendationPolicy } from "./policy";
import { createRouteMetrics } from "./route-metrics";
import type { ExistingAssignment, RecommendationResult, SurveyTarget, SurveyUser } from "./types";

type Client = SupabaseClient<any, "public", any>;

function names(value: unknown): string[] {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function regionFromAddress(value: unknown): string | null {
  const parts = String(value ?? "").trim().split(/\s+/);
  if (parts.length < 2) return parts[0] || null;
  return `${parts[0]} ${parts[1]}`;
}

function isNewRule(value: unknown) {
  return value !== "existing";
}

export interface CalculationOptions {
  targetIds?: number[];
  measurementDateFrom?: string;
  measurementDateTo?: string;
  createdBeforeOrAt?: string;
  allowExternalRoutes?: boolean;
}

export interface CalculationOutput {
  targets: SurveyTarget[];
  results: RecommendationResult[];
  missing: Array<{
    targetId: number; code: string; name: string; measurementDate: string;
    kind: "new" | "existing"; fields: string[];
  }>;
  blockedKeys: string[];
}

/** SELECT 전용 계산 경로. 이 함수는 insert/update/upsert/rpc를 호출하지 않는다. */
export async function calculateV2Recommendations(
  supabase: Client,
  options: CalculationOptions = {},
): Promise<CalculationOutput> {
  let targetQuery = supabase.from("measurement_target_business").select(
    "id, code, year, period, business_name, address, measurement_date, measurer_id, preliminary_survey_rule_type, created_at",
  ).not("measurement_date", "is", null);
  if (options.targetIds?.length) targetQuery = targetQuery.in("id", options.targetIds);
  if (options.measurementDateFrom) targetQuery = targetQuery.gte("measurement_date", options.measurementDateFrom);
  if (options.measurementDateTo) targetQuery = targetQuery.lte("measurement_date", options.measurementDateTo);
  if (options.createdBeforeOrAt) targetQuery = targetQuery.lte("created_at", options.createdBeforeOrAt);
  const { data: rawTargets, error: targetError } = await targetQuery;
  if (targetError) throw new Error(`V2_TARGET_QUERY_FAILED:${targetError.message}`);

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
  const { data: infoRows, error: infoError } = codes.length
    ? await supabase.from("business_info").select("code, latitude, longitude").in("code", codes)
    : { data: [], error: null };
  if (infoError) throw new Error(`V2_COORDINATE_QUERY_FAILED:${infoError.message}`);
  const coordinateByCode = new Map((infoRows ?? []).map((row: any) => [row.code, {
    latitude: Number(row.latitude), longitude: Number(row.longitude),
  }]));

  const missing: CalculationOutput["missing"] = [];
  const targets = (rawTargets ?? []).flatMap((row: any) => {
    const responsible = userById.get(Number(row.measurer_id));
    const fields = [!row.measurement_date && "measurement_date", !responsible && "responsible_user"].filter(Boolean) as string[];
    if (fields.length) {
      missing.push({
        targetId: Number(row.id), code: row.code, name: row.business_name,
        measurementDate: row.measurement_date,
        kind: isNewRule(row.preliminary_survey_rule_type) ? "new" : "existing",
        fields,
      });
      return [];
    }
    const rawCoordinate = coordinateByCode.get(row.code);
    const coordinate = rawCoordinate && rawCoordinate.latitude >= 33 && rawCoordinate.latitude <= 39 &&
      rawCoordinate.longitude >= 124 && rawCoordinate.longitude <= 132
      ? rawCoordinate : null;
    return [{
      id: Number(row.id), code: row.code, name: row.business_name, kind: isNewRule(row.preliminary_survey_rule_type) ? "new" : "existing",
      measurementDate: row.measurement_date, responsible: responsible!, address: row.address,
      region: regionFromAddress(row.address), coordinate, createdAt: row.created_at,
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
  const blockedKeys = new Set<string>();
  for (const block of blocks ?? []) {
    let cursor = String(block.start_date);
    while (cursor <= String(block.end_date)) {
      blockedKeys.add(`${block.user_id}:${cursor}`);
      const date = new Date(`${cursor}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); cursor = date.toISOString().slice(0, 10);
    }
  }
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
    "measurement_target_business_id, recommended_date, participant_user_ids, responsible_user_id, experienced_reviewer_id, status",
  ).eq("status", "recommended");
  const v2TableMissing = planError?.code === "42P01" || planError?.code === "PGRST205";
  if (planError && !v2TableMissing) throw new Error(`V2_PLAN_QUERY_FAILED:${planError.message}`);
  const planRows = v2TableMissing ? [] : (queriedPlanRows ?? []);
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const existingAssignments: ExistingAssignment[] = (planRows ?? []).flatMap((plan: any) => {
    if (!plan.recommended_date || options.targetIds?.includes(Number(plan.measurement_target_business_id))) return [];
    const target = targetById.get(Number(plan.measurement_target_business_id));
    return [{
      targetId: Number(plan.measurement_target_business_id), kind: target?.kind ?? "existing", date: plan.recommended_date,
      participants: Array.isArray(plan.participant_user_ids) ? plan.participant_user_ids.map(Number) : [],
      responsibleUserId: Number(plan.responsible_user_id), experiencedReviewerId: plan.experienced_reviewer_id ? Number(plan.experienced_reviewer_id) : null,
      coordinate: target?.coordinate ?? null, region: target?.region ?? null,
    }];
  });

  const results = await recommendBatch({
    targets, experiencedUsers: users.filter((user) => user.experienced && user.active !== false), existingAssignments,
    availability: { isBlocked: (userId, date) => blockedKeys.has(`${userId}:${date}`) },
    routes: createRouteMetrics(options.allowExternalRoutes === false ? "" : undefined),
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
      p_recommendation_reason: { reason: result.reason, evidence: result.evidence },
      p_route_evidence: result.evidence.route ?? {},
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
    await supabase.from("preliminary_survey_v2_plans").update({
      source_measurement_date: target.measurement_date, updated_at: new Date().toISOString(),
    }).eq("id", plan.id);
  }
  return null;
}
