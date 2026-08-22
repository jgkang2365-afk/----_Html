import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  calculateV2Recommendations,
  loadV2ManualContext,
} from "@/lib/preliminary-survey-v2/service";
import { v2BusinessKindLabel } from "@/lib/preliminary-survey-v2/presentation";
import { parseDateOnly, recommendationDatesForBusinessType } from "@/lib/preliminary-survey-v2/calendar";
import { measurementStaffForDate } from "@/lib/preliminary-survey-v2/measurement-staff";
import { loadActualMeasurementBlockedKeys } from "@/lib/preliminary-survey-v2/measurement-conflicts";
import {
  assignMeasurementAssignees,
  PUBLIC_SAMPLE_CODE_BY_NAME,
} from "@/lib/preliminary-survey-v2/measurement-assignment";
import { validateManualPlanHardRules } from "@/lib/preliminary-survey-v2/manual-validation";
import { createRouteMetrics } from "@/lib/preliminary-survey-v2/route-metrics";
import type { ExistingAssignment, SurveyMethod } from "@/lib/preliminary-survey-v2/types";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";

export const dynamic = "force-dynamic";

function normalizedPeriod(value: unknown) {
  return String(value ?? "").trim().replace("(수시)", "");
}

function journalKey(code: unknown, year: unknown, period: unknown) {
  return `${code}|${Number(year)}|${normalizedPeriod(period)}`;
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
  sourceAddress: string | null;
  sourceMeasurementParticipants: string;
  reason?: string;
  measurementAssigneeUserId: number;
  measurementAssigneeName: string;
  publicSampleCode: string;
  measurementAssignmentApprovalRequired?: boolean;
  recommendationReasons?: string[];
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
      !["new", "existing"].includes(value?.sourceRuleType) ||
      !Number.isInteger(Number(value?.measurementAssigneeUserId)) ||
      !String(value?.measurementAssigneeName ?? "").trim() ||
      !String(value?.publicSampleCode ?? "").trim()) return null;
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
    sourceAddress: value.sourceAddress == null ? null : String(value.sourceAddress),
    sourceMeasurementParticipants: String(value.sourceMeasurementParticipants ?? "-"),
    reason: typeof value.reason === "string" ? value.reason : undefined,
    measurementAssigneeUserId: Number(value.measurementAssigneeUserId),
    measurementAssigneeName: String(value.measurementAssigneeName),
    publicSampleCode: String(value.publicSampleCode),
    measurementAssignmentApprovalRequired: value.measurementAssignmentApprovalRequired === true,
    recommendationReasons: Array.isArray(value.recommendationReasons) ? value.recommendationReasons.map(String) : [],
  };
}

async function applySubmittedDrafts(supabase: any, rawDrafts: unknown[], approveThirdAssignment: boolean) {
  const drafts = rawDrafts.map(parseDraft);
  if (!drafts.length || drafts.some((draft) => !draft)) {
    return NextResponse.json({ error: "적용할 추천안 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const submitted = drafts as SubmittedDraft[];
  if (new Set(submitted.map((draft) => draft.targetId)).size !== submitted.length) {
    return NextResponse.json({ error: "중복된 추천안이 포함되어 있습니다." }, { status: 400 });
  }
  if (submitted.some((draft) => draft.measurementAssignmentApprovalRequired) && !approveThirdAssignment) {
    return NextResponse.json({
      error: "측정자 1인 3건 배정이 포함되어 예비조사 담당자 또는 관리자 승인이 필요합니다.",
      code: "MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED",
      approvalRequired: true,
    }, { status: 409 });
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
  const [{ data: blocks, error: blockError }, measurementBlockedKeys] = await Promise.all([
    participantIds.length && dates.length
      ? supabase.from("user_schedule_blocks").select("user_id, start_date, end_date")
          .in("user_id", participantIds).lte("start_date", dates.at(-1)).gte("end_date", dates[0])
      : Promise.resolve({ data: [], error: null }),
    loadActualMeasurementBlockedKeys(supabase, dates, allUsers),
  ]);
  if (blockError) throw blockError;
  const blockedKeys = new Set(measurementBlockedKeys);
  for (const block of blocks ?? []) {
    for (const date of dates) {
      if (String(block.start_date) <= date && String(block.end_date) >= date) blockedKeys.add(`${Number(block.user_id)}:${date}`);
    }
  }
  const reasons: Array<{ targetId: number; reason: string }> = [];
  const routes = createRouteMetrics();
  const draftAssignments: ExistingAssignment[] = submitted.map((draft, index) => {
    const context = contexts[index];
    const participants = draft.participantUserIds.flatMap((id) => context.users.find((user) => user.id === id) ?? []);
    const responsible = participants.find((user) => user.id === draft.sourceResponsibleUserId) ?? participants[0];
    const reviewer = participants.find((user) => user.id !== responsible?.id && user.experienced) ?? null;
    return {
      targetId: draft.targetId,
      businessCode: context.target.code,
      kind: context.target.kind,
      date: draft.preliminaryDate,
      participants: draft.participantUserIds,
      responsibleUserId: responsible?.id ?? draft.sourceResponsibleUserId,
      experiencedReviewerId: reviewer?.id ?? null,
      coordinate: context.target.coordinate,
      region: context.target.region,
    };
  });

  const validations = await Promise.all(submitted.map(async (draft, index) => {
    const context = contexts[index];
    const participants = draft.participantUserIds.flatMap((id) => context.users.find((user) => user.id === id) ?? []);
    const responsible = participants.find((user) => user.id === draft.sourceResponsibleUserId);
    const currentNames = participants.map((user) => user.name);
    if (lockedKeys.has(journalKey(context.target.code, context.target.classificationSource?.measurementYear, context.target.classificationSource?.measurementPeriod))) {
      reasons.push({ targetId: draft.targetId, reason: "유효한 측정일지가 생성되어 찐확정되었습니다." });
    }
    if (context.target.measurementDate !== draft.sourceMeasurementDate || context.target.sourceMeasurerId !== draft.sourceMeasurerId ||
        context.target.kind !== draft.sourceRuleType || context.target.address !== draft.sourceAddress ||
        context.target.measurementParticipantsSnapshot !== draft.sourceMeasurementParticipants) {
      reasons.push({ targetId: draft.targetId, reason: "추천 생성 후 측정계획 또는 업체 구분이 변경되었습니다." });
    }
    if (participants.length !== draft.participantUserIds.length || currentNames.join("|") !== draft.surveyors.join("|")) {
      reasons.push({ targetId: draft.targetId, reason: "추천 생성 후 조사자 정보가 변경되었습니다." });
    }
    const assignee = context.users.find((user) => user.id === draft.measurementAssigneeUserId);
    const expectedCode = PUBLIC_SAMPLE_CODE_BY_NAME[draft.measurementAssigneeName as keyof typeof PUBLIC_SAMPLE_CODE_BY_NAME];
    if (!responsible || !assignee || assignee.name !== draft.measurementAssigneeName || expectedCode !== draft.publicSampleCode) {
      reasons.push({ targetId: draft.targetId, reason: "측정자(공시료 담당자) 정보가 유효하지 않습니다." });
    }
    if (participants.some((user) => user.active === false) || draft.participantUserIds.some((id) => blockedKeys.has(`${id}:${draft.preliminaryDate}`))) {
      reasons.push({ targetId: draft.targetId, reason: "추천 생성 후 조사자 제외 일정 또는 측정 업무가 추가되었습니다." });
    }
    if (context.target.kind === "new" && draft.surveyMethod !== "field") {
      reasons.push({ targetId: draft.targetId, reason: "신규업체는 현장 예비조사 방식이어야 합니다." });
    }
    const validation = await validateManualPlanHardRules({
      target: { ...context.target, responsible: responsible ?? context.target.responsible },
      recommendedDate: draft.preliminaryDate,
      participants,
      existingAssignments: [
        ...context.assignments.filter((assignment) => !draftIds.has(assignment.targetId)),
        ...draftAssignments.filter((assignment) => assignment.targetId !== draft.targetId),
      ],
      routes,
    });
    for (const reason of validation.errors) reasons.push({ targetId: draft.targetId, reason });
    return { validation, participants, responsible };
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
    const { validation, participants, responsible } = validations[index];
    return {
      target_id: draft.targetId,
      recommended_date: draft.preliminaryDate,
      responsible_user_id: responsible!.id,
      experienced_reviewer_id: validation.experiencedReviewer?.id ?? null,
      participant_user_ids: draft.participantUserIds,
      participant_names: participants.map((user) => user.name),
      status: "recommended",
      plan_origin: "manual",
      source_measurement_date: draft.sourceMeasurementDate,
      source_responsible_user_id: draft.sourceMeasurerId,
      source_rule_type: draft.sourceRuleType,
      survey_method: draft.surveyMethod,
      recommendation_reason: {
        reason: draft.reason ?? "Phase B 검토 완료 draft 적용",
        shortReasons: draft.recommendationReasons ?? [],
        sourceContext: {
          address: draft.sourceAddress,
          measurementParticipants: draft.sourceMeasurementParticipants,
        },
        measurementAssignee: {
          userId: draft.measurementAssigneeUserId,
          name: draft.measurementAssigneeName,
          publicSampleCode: draft.publicSampleCode,
          approvalRequired: draft.measurementAssignmentApprovalRequired === true,
          approved: draft.measurementAssignmentApprovalRequired === true && approveThirdAssignment,
        },
      },
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
      const staff = measurementStaffForDate({
        dailyStaff: target.daily_staff,
        measurementDate: target.measurement_date,
        collaborators: target.collaborators,
        userNameById,
      });
      const sourceContext = plan?.recommendation_reason?.sourceContext;
      const stale = Boolean(plan && (
        plan.source_measurement_date !== target.measurement_date ||
        plan.source_responsible_user_id !== target.measurer_id ||
        (sourceContext && (
          sourceContext.address !== target.address ||
          sourceContext.measurementParticipants !== staff.measurementParticipants
        ))
      ));
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
      const measurementAssignee = plan?.recommendation_reason?.measurementAssignee;
      const measurementAssigneeLabel = measurementAssignee?.name && measurementAssignee?.publicSampleCode
        ? `${measurementAssignee.name} ${measurementAssignee.publicSampleCode}`
        : "-";
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
        mainMeasurer: measurementAssigneeLabel,
        measurementParticipants: staff.measurementParticipants,
        reportWriter: userNameById.get(Number(target.measurer_id)) ?? "-",
        status,
        conflict: stale ? "측정계획 영향값 변경" : plan?.status === "manual_required" ? "조정 필요" : null,
        reason: plan?.recommendation_reason?.reason ?? null,
        recommendationReasons: Array.isArray(plan?.recommendation_reason?.shortReasons)
          ? plan.recommendation_reason.shortReasons : [],
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
    const body = await request.json();
    const supabase = await createClient();
    if (!await canManagePreliminarySurvey(supabase, session)) {
      return NextResponse.json({ error: "예비조사 담당자 또는 관리자만 추천안을 생성·적용할 수 있습니다." }, { status: 403 });
    }
    if (body.action === "apply") {
      return applySubmittedDrafts(
        supabase,
        Array.isArray(body.drafts) ? body.drafts : [],
        body.approveThirdAssignment === true,
      );
    }
    if (body.action !== "recommend") {
      return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
    }
    if (!Array.isArray(body.targetIds) || body.targetIds.length === 0) {
      return NextResponse.json({ error: "추천할 사업장을 선택해 주세요." }, { status: 400 });
    }
    const requestedTargetIds = body.targetIds.map(Number);
    if (requestedTargetIds.some((value: number) => !Number.isInteger(value) || value <= 0) ||
        new Set(requestedTargetIds).size !== requestedTargetIds.length) {
      return NextResponse.json({ error: "추천 대상 사업장 정보가 올바르지 않습니다." }, { status: 400 });
    }
    let targetIds = requestedTargetIds;
    const explicitTargetSelection = body.explicitTargetSelection === true;
    const measurementDateFrom = body.measurementDateFrom == null || body.measurementDateFrom === ""
      ? undefined : String(body.measurementDateFrom);
    const measurementDateTo = body.measurementDateTo == null || body.measurementDateTo === ""
      ? undefined : String(body.measurementDateTo);
    if ((measurementDateFrom && !parseDateOnly(measurementDateFrom)) ||
        (measurementDateTo && !parseDateOnly(measurementDateTo)) ||
        (measurementDateFrom && measurementDateTo && measurementDateFrom > measurementDateTo)) {
      return NextResponse.json({ error: "측정예정일 기간이 올바르지 않습니다." }, { status: 400 });
    }
    const preliminaryDateFrom = body.preliminaryDateFrom == null || body.preliminaryDateFrom === ""
      ? undefined : String(body.preliminaryDateFrom);
    const preliminaryDateTo = body.preliminaryDateTo == null || body.preliminaryDateTo === ""
      ? undefined : String(body.preliminaryDateTo);
    if ((preliminaryDateFrom && !parseDateOnly(preliminaryDateFrom)) ||
        (preliminaryDateTo && !parseDateOnly(preliminaryDateTo)) ||
        (preliminaryDateFrom && preliminaryDateTo && preliminaryDateFrom > preliminaryDateTo)) {
      return NextResponse.json({ error: "예비조사 기간이 올바르지 않습니다." }, { status: 400 });
    }
    // 업체별 재추천은 한 행만 독립 계산하지 않는다. 같은 예비조사일/조사자,
    // 같은 주소, 같은 측정일의 측정자 균등배정 범위를 draft에 함께 포함한다.
    if (requestedTargetIds.length === 1) {
      const targetId = requestedTargetIds[0];
      const [{ data: targetRow }, { data: targetPlan }, { data: relatedPlans }] = await Promise.all([
        supabase.from("measurement_target_business").select("id, measurement_date, address").eq("id", targetId).maybeSingle(),
        supabase.from("preliminary_survey_v2_plans").select("recommended_date, participant_user_ids").eq("measurement_target_business_id", targetId).maybeSingle(),
        supabase.from("preliminary_survey_v2_plans").select("measurement_target_business_id, recommended_date, participant_user_ids"),
      ]);
      const participantIds = new Set(Array.isArray(targetPlan?.participant_user_ids) ? targetPlan.participant_user_ids.map(Number) : []);
      const { data: sameMeasurementTargets } = targetRow?.measurement_date
        ? await supabase.from("measurement_target_business").select("id").eq("measurement_date", targetRow.measurement_date)
        : { data: [] };
      const { data: sameAddressTargets } = targetRow?.address
        ? await supabase.from("measurement_target_business").select("id").eq("address", targetRow.address)
        : { data: [] };
      const planRelatedIds = (relatedPlans ?? []).filter((plan: any) =>
        (targetPlan?.recommended_date && plan.recommended_date === targetPlan.recommended_date) ||
        (Array.isArray(plan.participant_user_ids) && plan.participant_user_ids.some((id: unknown) => participantIds.has(Number(id)))),
      ).map((plan: any) => Number(plan.measurement_target_business_id));
      const relationCandidates = [...new Set([
        targetId,
        ...planRelatedIds,
        ...(sameMeasurementTargets ?? []).map((candidate: any) => Number(candidate.id)),
        ...(sameAddressTargets ?? []).map((candidate: any) => Number(candidate.id)),
      ])];
      const { data: relationTargets } = relationCandidates.length
        ? await supabase.from("measurement_target_business").select("id, measurement_date, address").in("id", relationCandidates)
        : { data: [] };
      const normalizedAddress = String(targetRow?.address ?? "").replace(/\s+/g, "");
      targetIds = [...new Set((relationTargets ?? []).filter((candidate: any) =>
        Number(candidate.id) === targetId ||
        candidate.measurement_date === targetRow?.measurement_date ||
        (normalizedAddress && String(candidate.address ?? "").replace(/\s+/g, "") === normalizedAddress),
      ).map((candidate: any) => Number(candidate.id)))];
    }
    let candidateQuery = supabase.from("measurement_target_business").select("id, code, year, period, measurement_date");
    candidateQuery = candidateQuery.in("id", targetIds);
    if (measurementDateFrom) candidateQuery = candidateQuery.gte("measurement_date", measurementDateFrom);
    if (measurementDateTo) candidateQuery = candidateQuery.lte("measurement_date", measurementDateTo);
    const { data: candidateRows, error: candidateError } = await candidateQuery;
    if (candidateError) throw candidateError;
    const candidateCodes = [...new Set((candidateRows ?? []).map((row: any) => row.code))];
    const candidateIds = (candidateRows ?? []).map((row: any) => Number(row.id));
    const [{ data: journalRows, error: journalError }, { data: planRows, error: planError }] = await Promise.all([
      candidateCodes.length
        ? supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", candidateCodes)
        : Promise.resolve({ data: [], error: null }),
      !explicitTargetSelection && candidateIds.length
        ? supabase.from("preliminary_survey_v2_plans").select("measurement_target_business_id, plan_origin, source_measurement_date").in("measurement_target_business_id", candidateIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (journalError || planError) throw journalError || planError;
    const confirmedKeys = new Set((journalRows ?? []).map((row: any) => journalKey(row.code, row.measurement_year, row.measurement_period)));
    const selectedTargetIds = new Set(targetIds);
    const planByTarget = new Map((planRows ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
    const eligibleTargetIds = (candidateRows ?? []).filter((row: any) => {
      if (!selectedTargetIds.has(Number(row.id))) return false;
      if (confirmedKeys.has(journalKey(row.code, row.year, row.period))) return false;
      if (explicitTargetSelection) return true;
      const plan: any = planByTarget.get(Number(row.id));
      return !plan || plan.plan_origin !== "manual" || plan.source_measurement_date !== row.measurement_date;
    }).map((row: any) => Number(row.id));
    if (!eligibleTargetIds.length) {
      return NextResponse.json({ success: true, drafts: [], missing: [], scope: targetIds.length === 1 ? "target_business" : "range", impactSummary: "변경 가능한 대상이 없습니다." });
    }
    const output = await calculateV2Recommendations(supabase, {
      targetIds: eligibleTargetIds,
      measurementDateFrom,
      measurementDateTo,
      preliminaryDateFrom,
      preliminaryDateTo,
    });

    // 측정자(=메인측정자=공시료 담당자)는 예비조사자 계산이 끝난 뒤 별도로 배정한다.
    // 기존 적용 계획은 recommendation_reason의 명시적 measurementAssignee만 읽으며,
    // report writer / participants / legacy collaborators에서는 절대 추론하지 않는다.
    const [{ data: assigneeUsers, error: assigneeUserError }, { data: existingPlanRows, error: existingPlanError }] = await Promise.all([
      supabase.from("users").select("id, name, is_active").in("name", Object.keys(PUBLIC_SAMPLE_CODE_BY_NAME)),
      supabase.from("preliminary_survey_v2_plans").select("measurement_target_business_id, recommendation_reason"),
    ]);
    if (assigneeUserError || existingPlanError) throw assigneeUserError || existingPlanError;
    const existingPlanTargetIds = (existingPlanRows ?? [])
      .map((plan: any) => Number(plan.measurement_target_business_id))
      .filter((id: number) => !eligibleTargetIds.includes(id));
    const { data: existingTargetRows, error: existingTargetError } = existingPlanTargetIds.length
      ? await supabase.from("measurement_target_business").select("id, measurement_date, address").in("id", existingPlanTargetIds)
      : { data: [], error: null };
    if (existingTargetError) throw existingTargetError;
    const existingTargetById = new Map((existingTargetRows ?? []).map((target: any) => [Number(target.id), target]));
    const existingMeasurementAssignments = (existingPlanRows ?? []).flatMap((plan: any) => {
      const target: any = existingTargetById.get(Number(plan.measurement_target_business_id));
      const value = plan.recommendation_reason?.measurementAssignee;
      if (!target?.measurement_date || !Number.isInteger(Number(value?.userId))) return [];
      return [{
        targetId: Number(plan.measurement_target_business_id),
        measurementDate: String(target.measurement_date),
        address: target.address ?? null,
        coordinate: null,
        userId: Number(value.userId),
      }];
    });
    const measurementAssignments = assignMeasurementAssignees({
      targets: output.results.filter((result) => result.status === "recommended").map((result) => {
        const target = output.targets.find((item) => item.id === result.targetId)!;
        return {
          targetId: target.id,
          measurementDate: target.measurementDate,
          address: target.address,
          coordinate: target.coordinate,
        };
      }),
      users: (assigneeUsers ?? []).map((user: any) => ({ id: Number(user.id), name: user.name, active: user.is_active })),
      existing: existingMeasurementAssignments,
    });
    const measurementAssignmentByTarget = new Map(measurementAssignments.map((assignment) => [assignment.targetId, assignment]));

    return NextResponse.json({
      success: true,
      drafts: output.results.map((result) => {
        const target = output.targets.find((item) => item.id === result.targetId)!;
        const measurementAssignment = measurementAssignmentByTarget.get(result.targetId);
        const recommendationReasons = [
          `${target.businessType === "external_new" ? "타기관 신규" : target.businessType === "first_measurement" ? "최초실시" : "기존업체"} · ${result.surveyMethod === "field" ? "방문" : "유선"}`,
          measurementAssignment?.reason,
        ].filter(Boolean);
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
          sourceAddress: target.address,
          sourceMeasurementParticipants: target.measurementParticipantsSnapshot ?? "-",
          measurementAssigneeUserId: measurementAssignment?.userId,
          measurementAssigneeName: measurementAssignment?.userName,
          publicSampleCode: measurementAssignment?.publicSampleCode,
          measurementAssignmentApprovalRequired: measurementAssignment?.approvalRequired ?? false,
          recommendationReasons,
          mainMeasurer: measurementAssignment ? `${measurementAssignment.userName} ${measurementAssignment.publicSampleCode}` : "-",
          status: result.status === "recommended" && measurementAssignment ? "recommended" : "adjustment_required",
          conflict: result.status === "manual_required"
            ? result.reason
            : !measurementAssignment ? "측정자(공시료 담당자) 배정 불가" : measurementAssignment.approvalRequired ? "3건 승인 필요" : null,
          reason: result.reason,
          alternatives: recommendationDatesForBusinessType(
            target.measurementDate,
            target.businessType ?? (target.kind === "existing" ? "existing" : "first_measurement"),
          ).map((item) => item.date).filter((date) =>
            (!preliminaryDateFrom || date >= preliminaryDateFrom) &&
            (!preliminaryDateTo || date <= preliminaryDateTo) &&
            date !== result.date,
          ).slice(0, 3),
        };
      }),
      missing: output.missing,
      scope: targetIds.length === 1 ? "target_business" : "range",
      impactSummary: requestedTargetIds.length === 1
        ? `${targetIds.length}개 영향 범위(같은 예비조사일·조사자·주소·측정일)를 재검증했습니다.`
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WORKBENCH_RECOMMEND_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
