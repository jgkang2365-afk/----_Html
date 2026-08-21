import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  calculateV2Recommendations,
  loadV2ManualContext,
} from "@/lib/preliminary-survey-v2/service";
import { v2BusinessKindLabel } from "@/lib/preliminary-survey-v2/presentation";
import { recommendationDatesForBusinessType } from "@/lib/preliminary-survey-v2/calendar";
import { measurementStaffForDate } from "@/lib/preliminary-survey-v2/measurement-staff";
import { validateManualPlanHardRules } from "@/lib/preliminary-survey-v2/manual-validation";
import { createRouteMetrics } from "@/lib/preliminary-survey-v2/route-metrics";
import type { ExistingAssignment, SurveyMethod } from "@/lib/preliminary-survey-v2/types";

export const dynamic = "force-dynamic";

function normalizedPeriod(value: unknown) {
  return String(value ?? "").trim().replace("(수시)", "");
}

function journalKey(code: unknown, year: unknown, period: unknown) {
  return `${code}|${Number(year)}|${normalizedPeriod(period)}`;
}

function names(value: unknown) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

async function requireSurveyAccess() {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

interface SubmittedDraft {
  targetId: number;
  preliminaryDate: string;
  participantUserIds: number[];
  surveyors: string[];
  surveyMethod: SurveyMethod;
  sourceMeasurementDate: string;
  sourceMeasurerId: number | null;
  sourceResponsibleUserId: number;
  sourceRuleType: "new" | "existing";
  reason?: string;
}

function parseDraft(value: any): SubmittedDraft | null {
  const participantUserIds = Array.isArray(value?.participantUserIds)
    ? value.participantUserIds.map(Number).filter(Number.isInteger)
    : [];
  if (!Number.isInteger(Number(value?.targetId)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(value?.preliminaryDate ?? "")) ||
      !participantUserIds.length || !Array.isArray(value?.surveyors) ||
      !["field", "phone"].includes(value?.surveyMethod) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(String(value?.sourceMeasurementDate ?? "")) ||
      !Number.isInteger(Number(value?.sourceResponsibleUserId)) ||
      !(value?.sourceMeasurerId == null || Number.isInteger(Number(value.sourceMeasurerId))) ||
      !["new", "existing"].includes(value?.sourceRuleType)) return null;
  return {
    targetId: Number(value.targetId),
    preliminaryDate: String(value.preliminaryDate),
    participantUserIds: [...new Set<number>(participantUserIds)],
    surveyors: value.surveyors.map(String),
    surveyMethod: value.surveyMethod,
    sourceMeasurementDate: String(value.sourceMeasurementDate),
    sourceMeasurerId: value.sourceMeasurerId == null ? null : Number(value.sourceMeasurerId),
    sourceResponsibleUserId: Number(value.sourceResponsibleUserId),
    sourceRuleType: value.sourceRuleType,
    reason: typeof value.reason === "string" ? value.reason : undefined,
  };
}

async function applySubmittedDrafts(supabase: any, rawDrafts: unknown[]) {
  const drafts = rawDrafts.map(parseDraft);
  if (!drafts.length || drafts.some((draft) => !draft)) {
    return NextResponse.json({ error: "적용할 추천안 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const submitted = drafts as SubmittedDraft[];
  if (new Set(submitted.map((draft) => draft.targetId)).size !== submitted.length) {
    return NextResponse.json({ error: "중복된 추천안이 포함되어 있습니다." }, { status: 400 });
  }

  let contexts: Awaited<ReturnType<typeof loadV2ManualContext>>[];
  try {
    contexts = await Promise.all(submitted.map((draft) =>
      loadV2ManualContext(supabase, draft.targetId, draft.preliminaryDate)));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "DRAFT_SOURCE_CHANGED";
    return NextResponse.json({
      error: "추천 생성 후 사업장 또는 연계측정자 정보가 변경되어 저장하지 않았습니다.",
      code: "DRAFT_REVIEW_REQUIRED",
      reviewRequired: true,
      reasons: submitted.map((draft) => ({ targetId: draft.targetId, reason })),
    }, { status: 409 });
  }
  const draftIds = new Set(submitted.map((draft) => draft.targetId));
  const codes = [...new Set(contexts.map((context) => context.target.code))];
  const { data: journals, error: journalError } = codes.length
    ? await supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", codes)
    : { data: [], error: null };
  if (journalError) throw journalError;
  const lockedKeys = new Set((journals ?? []).map((row: any) =>
    journalKey(row.code, row.measurement_year, row.measurement_period)));
  const dates = [...new Set(submitted.map((draft) => draft.preliminaryDate))].sort();
  const participantIds = [...new Set(submitted.flatMap((draft) => draft.participantUserIds))];
  const allUsers = contexts[0]?.users ?? [];
  const userIdByName = new Map(allUsers.map((user) => [user.name, user.id]));
  const [{ data: blocks, error: blockError }, { data: measurementSchedules, error: scheduleError }] = await Promise.all([
    participantIds.length && dates.length
      ? supabase.from("user_schedule_blocks").select("user_id, start_date, end_date")
          .in("user_id", participantIds).lte("start_date", dates.at(-1)).gte("end_date", dates[0])
      : Promise.resolve({ data: [], error: null }),
    dates.length
      ? supabase.from("preliminary_survey").select("measurement_date, measurer, actual_measurer, report_writer")
          .in("measurement_date", dates)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (blockError || scheduleError) throw blockError || scheduleError;
  const blockedKeys = new Set<string>();
  for (const block of blocks ?? []) {
    for (const date of dates) {
      if (String(block.start_date) <= date && String(block.end_date) >= date) blockedKeys.add(`${Number(block.user_id)}:${date}`);
    }
  }
  for (const schedule of measurementSchedules ?? []) {
    for (const name of new Set([
      ...names(schedule.measurer), ...names(schedule.actual_measurer), ...names(schedule.report_writer),
    ])) {
      const userId = userIdByName.get(name);
      if (userId) blockedKeys.add(`${userId}:${schedule.measurement_date}`);
    }
  }
  const reasons: Array<{ targetId: number; reason: string }> = [];
  const routes = createRouteMetrics();
  const draftAssignments: ExistingAssignment[] = submitted.map((draft, index) => {
    const context = contexts[index];
    const participants = draft.participantUserIds.flatMap((id) => context.users.find((user) => user.id === id) ?? []);
    const reviewer = participants.find((user) => user.id !== context.target.responsible.id && user.experienced) ?? null;
    return {
      targetId: draft.targetId,
      businessCode: context.target.code,
      kind: context.target.kind,
      date: draft.preliminaryDate,
      participants: draft.participantUserIds,
      responsibleUserId: context.target.responsible.id,
      experiencedReviewerId: reviewer?.id ?? null,
      coordinate: context.target.coordinate,
      region: context.target.region,
    };
  });

  const validations = await Promise.all(submitted.map(async (draft, index) => {
    const context = contexts[index];
    const participants = draft.participantUserIds.flatMap((id) => context.users.find((user) => user.id === id) ?? []);
    const currentNames = participants.map((user) => user.name);
    if (lockedKeys.has(journalKey(context.target.code, context.target.classificationSource?.measurementYear, context.target.classificationSource?.measurementPeriod))) {
      reasons.push({ targetId: draft.targetId, reason: "유효한 측정일지가 생성되어 찐확정되었습니다." });
    }
    if (context.target.measurementDate !== draft.sourceMeasurementDate || context.target.sourceMeasurerId !== draft.sourceMeasurerId ||
        context.target.responsible.id !== draft.sourceResponsibleUserId ||
        context.target.kind !== draft.sourceRuleType) {
      reasons.push({ targetId: draft.targetId, reason: "추천 생성 후 측정계획 또는 업체 구분이 변경되었습니다." });
    }
    if (participants.length !== draft.participantUserIds.length || currentNames.join("|") !== draft.surveyors.join("|")) {
      reasons.push({ targetId: draft.targetId, reason: "추천 생성 후 조사자 정보가 변경되었습니다." });
    }
    if (participants.some((user) => user.active === false) || draft.participantUserIds.some((id) => blockedKeys.has(`${id}:${draft.preliminaryDate}`))) {
      reasons.push({ targetId: draft.targetId, reason: "추천 생성 후 조사자 제외 일정 또는 측정 업무가 추가되었습니다." });
    }
    if (context.target.kind === "new" && draft.surveyMethod !== "field") {
      reasons.push({ targetId: draft.targetId, reason: "신규업체는 현장 예비조사 방식이어야 합니다." });
    }
    const validation = await validateManualPlanHardRules({
      target: context.target,
      recommendedDate: draft.preliminaryDate,
      participants,
      existingAssignments: [
        ...context.assignments.filter((assignment) => !draftIds.has(assignment.targetId)),
        ...draftAssignments.filter((assignment) => assignment.targetId !== draft.targetId),
      ],
      routes,
    });
    for (const reason of validation.errors) reasons.push({ targetId: draft.targetId, reason });
    return { validation, participants };
  }));

  if (reasons.length) {
    return NextResponse.json({
      error: "추천안의 전제 조건이 변경되어 저장하지 않았습니다. 새 추천이 필요합니다.",
      code: "DRAFT_REVIEW_REQUIRED",
      reviewRequired: true,
      reasons,
    }, { status: 409 });
  }

  const payload = submitted.map((draft, index) => {
    const context = contexts[index];
    const { validation, participants } = validations[index];
    return {
      target_id: draft.targetId,
      recommended_date: draft.preliminaryDate,
      responsible_user_id: context.target.responsible.id,
      experienced_reviewer_id: validation.experiencedReviewer?.id ?? null,
      participant_user_ids: draft.participantUserIds,
      participant_names: participants.map((user) => user.name),
      status: "recommended",
      plan_origin: "manual",
      source_measurement_date: draft.sourceMeasurementDate,
      source_responsible_user_id: draft.sourceMeasurerId,
      source_rule_type: draft.sourceRuleType,
      survey_method: draft.surveyMethod,
      recommendation_reason: { reason: draft.reason ?? "Phase B 검토 완료 draft 적용" },
      route_evidence: { validatedAtApply: true },
      warnings: [],
    };
  });
  const { data, error } = await supabase.rpc("persist_preliminary_survey_v2_plan_batch", { p_plans: payload });
  if (error) {
    return NextResponse.json({
      error: "저장 직전 원천값이 변경되어 저장하지 않았습니다. 새 추천이 필요합니다.",
      code: "DRAFT_REVIEW_REQUIRED",
      reviewRequired: true,
    }, { status: 409 });
  }
  return NextResponse.json({ success: true, appliedCount: Array.isArray(data) ? data.length : 0, appliedDrafts: submitted });
}

export async function GET(request: NextRequest) {
  try {
    await requireSurveyAccess();
    const params = new URL(request.url).searchParams;
    const year = Number(params.get("year") || new Date().getFullYear());
    const period = params.get("period") || "";
    const supabase = await createClient();

    let targetQuery = supabase.from("measurement_target_business").select(
      "id, code, year, period, business_name, address, measurement_date, business_type, preliminary_survey_rule_type, collaborators, daily_staff, measurer_id, link_measurer_id",
    ).eq("year", year).order("measurement_date", { ascending: true });
    if (period) targetQuery = targetQuery.eq("period", period);
    const { data: targets, error: targetError } = await targetQuery;
    if (targetError) throw targetError;

    const targetIds = (targets ?? []).map((target: any) => Number(target.id));
    const codes = [...new Set((targets ?? []).map((target: any) => target.code))];
    const [{ data: plans, error: planError }, { data: journals, error: journalError }, { data: users, error: userError }] = await Promise.all([
      targetIds.length
        ? supabase.from("preliminary_survey_v2_plans").select("*").in("measurement_target_business_id", targetIds)
        : Promise.resolve({ data: [], error: null }),
      codes.length
        ? supabase.from("measurement_journal").select("id, code, measurement_year, measurement_period").in("code", codes)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("users").select("id, name, is_active, is_preliminary_survey_experienced, job").eq("job", "측정"),
    ]);
    if (planError || journalError || userError) throw planError || journalError || userError;

    const planByTarget = new Map((plans ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
    const userNameById = new Map((users ?? []).map((user: any) => [Number(user.id), user.name]));
    const confirmedKeys = new Set((journals ?? []).map((row: any) =>
      journalKey(row.code, row.measurement_year, row.measurement_period),
    ));

    const rows = (targets ?? []).map((target: any) => {
      const plan: any = planByTarget.get(Number(target.id)) ?? null;
      const trueConfirmed = confirmedKeys.has(journalKey(target.code, target.year, target.period));
      const stale = Boolean(plan && plan.source_measurement_date !== target.measurement_date);
      const status = trueConfirmed
        ? "true_confirmed"
        : stale || plan?.plan_origin === "automatic"
          ? "review_required"
          : plan?.status === "manual_required"
            ? "adjustment_required"
            : plan ? "provisional" : "unassigned";
      const kind = target.business_type === "external_new"
        ? "타기관 신규"
        : target.business_type === "first_measurement"
          ? "최초실시"
          : target.business_type === "existing"
            ? "기존업체"
            : v2BusinessKindLabel(plan?.source_rule_type ?? target.preliminary_survey_rule_type ?? "existing", plan?.recommendation_reason ?? null);
      const staff = measurementStaffForDate({
        dailyStaff: target.daily_staff,
        measurementDate: target.measurement_date,
        collaborators: target.collaborators,
        userNameById,
      });
      return {
        targetId: Number(target.id),
        code: target.code,
        businessName: target.business_name,
        address: target.address,
        year: Number(target.year),
        period: target.period,
        kind,
        measurementDate: target.measurement_date,
        preliminaryDate: plan?.recommended_date ?? null,
        surveyors: Array.isArray(plan?.participant_names) ? plan.participant_names : [],
        surveyMethod: plan?.survey_method ?? (kind === "기존업체" ? "phone" : "field"),
        mainMeasurer: staff.mainMeasurer,
        helper: staff.helper,
        reportWriter: userNameById.get(Number(target.measurer_id)) ?? "-",
        status,
        conflict: stale ? "측정예정일 변경" : plan?.status === "manual_required" ? "조정 필요" : null,
        planOrigin: plan?.plan_origin ?? null,
        locked: trueConfirmed,
      };
    });
    return NextResponse.json({ rows, users: users ?? [], year, period });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKBENCH_QUERY_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireSurveyAccess();
    if (session.role !== "관리자") {
      return NextResponse.json({ error: "관리자만 추천안을 생성·적용할 수 있습니다." }, { status: 403 });
    }
    const body = await request.json();
    const supabase = await createClient();
    if (body.action === "apply") {
      return applySubmittedDrafts(supabase, Array.isArray(body.drafts) ? body.drafts : []);
    }
    const targetIds: number[] = Array.isArray(body.targetIds)
      ? [...new Set<number>(body.targetIds.map(Number).filter((value: number) => Number.isInteger(value)))]
      : [];
    let candidateQuery = supabase.from("measurement_target_business").select("id, code, year, period, measurement_date");
    if (targetIds.length) {
      candidateQuery = candidateQuery.in("id", targetIds);
    } else {
      candidateQuery = candidateQuery.eq("year", Number(body.year || new Date().getFullYear()));
      if (body.period) candidateQuery = candidateQuery.eq("period", String(body.period));
    }
    const { data: candidateRows, error: candidateError } = await candidateQuery;
    if (candidateError) throw candidateError;
    const candidateCodes = [...new Set((candidateRows ?? []).map((row: any) => row.code))];
    const candidateIds = (candidateRows ?? []).map((row: any) => Number(row.id));
    const [{ data: journalRows, error: journalError }, { data: planRows, error: planError }] = await Promise.all([
      candidateCodes.length
        ? supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", candidateCodes)
        : Promise.resolve({ data: [], error: null }),
      candidateIds.length
        ? supabase.from("preliminary_survey_v2_plans").select("measurement_target_business_id, plan_origin, source_measurement_date").in("measurement_target_business_id", candidateIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (journalError || planError) throw journalError || planError;
    const confirmedKeys = new Set((journalRows ?? []).map((row: any) => journalKey(row.code, row.measurement_year, row.measurement_period)));
    const planByTarget = new Map((planRows ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
    const eligibleTargetIds = (candidateRows ?? []).filter((row: any) => {
      if (confirmedKeys.has(journalKey(row.code, row.year, row.period))) return false;
      if (targetIds.length) return true;
      const plan: any = planByTarget.get(Number(row.id));
      return !plan || plan.plan_origin !== "manual" || plan.source_measurement_date !== row.measurement_date;
    }).map((row: any) => Number(row.id));
    if (!eligibleTargetIds.length) {
      return NextResponse.json({ success: true, drafts: [], missing: [], scope: targetIds.length === 1 ? "target_business" : "range", impactSummary: "변경 가능한 대상이 없습니다." });
    }
    const output = await calculateV2Recommendations(supabase, {
      targetIds: eligibleTargetIds,
    });

    return NextResponse.json({
      success: true,
      drafts: output.results.map((result) => {
        const target = output.targets.find((item) => item.id === result.targetId)!;
        return {
          targetId: result.targetId,
          code: target.code,
          businessName: target.name,
          kind: target.businessType === "external_new" ? "타기관 신규" : target.businessType === "first_measurement" ? "최초실시" : "기존업체",
          measurementDate: target.measurementDate,
          preliminaryDate: result.date,
          participantUserIds: result.participants.map((user) => user.id),
          surveyors: result.participants.map((user) => user.name),
          surveyMethod: result.surveyMethod,
          sourceMeasurementDate: target.measurementDate,
          sourceMeasurerId: target.sourceMeasurerId ?? null,
          sourceResponsibleUserId: result.responsible.id,
          sourceRuleType: target.kind,
          status: result.status === "recommended" ? "recommended" : "adjustment_required",
          conflict: result.status === "manual_required" ? result.reason : null,
          reason: result.reason,
          alternatives: recommendationDatesForBusinessType(
            target.measurementDate,
            target.businessType ?? (target.kind === "existing" ? "existing" : "first_measurement"),
          ).map((item) => item.date).filter((date) => date !== result.date).slice(0, 3),
        };
      }),
      missing: output.missing,
      scope: targetIds.length === 1 ? "target_business" : "range",
      impactSummary: targetIds.length === 1 ? "기존 가확정은 유지하고 같은 날짜·관련 조사자 제약을 재검증했습니다." : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKBENCH_RECOMMEND_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
