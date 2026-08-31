import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { validateManualPlanHardRules } from "@/lib/preliminary-survey-v2/manual-validation";
import { createRouteMetrics } from "@/lib/preliminary-survey-v2/route-metrics";
import { loadV2ManualContext } from "@/lib/preliminary-survey-v2/service";
import { surveyMethodForKind, type SurveyUser } from "@/lib/preliminary-survey-v2/types";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";
import { buildScheduleBlockKeys } from "@/lib/preliminary-survey-v2/availability";
import { loadActualMeasurementBlockedKeys } from "@/lib/preliminary-survey-v2/measurement-conflicts";
import {
  isMeasurementAssignmentSchemaMissing,
  recomputeCanonicalMeasurementAssignments,
} from "@/lib/preliminary-survey-v2/measurement-assignment-persistence";

function deleteErrorResponse(message: string) {
  if (message.includes("TRUE_CONFIRMED_LOCKED")) {
    return NextResponse.json({ error: "찐확정된 예비조사 계획은 삭제할 수 없습니다.", code: "TRUE_CONFIRMED_LOCKED" }, { status: 409 });
  }
  if (message.includes("PLAN_DELETE_PROTECTED_HISTORY")) {
    return NextResponse.json({ error: "역사 복원 또는 정합성 추적에 사용된 계획은 삭제할 수 없습니다.", code: "PLAN_DELETE_PROTECTED_HISTORY" }, { status: 409 });
  }
  if (message.includes("MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED")) {
    return NextResponse.json({
      error: "계획 삭제 후 해당 측정자의 배정이 3건이 되어 승인이 필요합니다.",
      code: "MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED",
      approvalRequired: true,
    }, { status: 409 });
  }
  if (message.includes("MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED")) {
    return NextResponse.json({ error: "계획 삭제 후에도 측정자 배정이 4건 이상인 그룹이 남아 삭제할 수 없습니다.", code: "MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED" }, { status: 409 });
  }
  if (message.includes("PLAN_NOT_FOUND")) {
    return NextResponse.json({ error: "삭제할 예비조사 계획이 없습니다.", code: "PLAN_NOT_FOUND" }, { status: 404 });
  }
  if (message.includes("PLAN_DELETE_SOURCE_CHANGED")) {
    return NextResponse.json({ error: "계획의 측정자 배정이 변경되었습니다. 목록을 새로고침한 뒤 다시 시도해 주세요.", code: "PLAN_DELETE_SOURCE_CHANGED", reviewRequired: true }, { status: 409 });
  }
  return NextResponse.json({ error: "예비조사 계획 삭제에 실패했습니다.", code: "PLAN_DELETE_FAILED" }, { status: 500 });
}

function normalizedPeriod(value: unknown) {
  return String(value ?? "").replace("(수시)", "").trim();
}

export async function DELETE(request: NextRequest, { params }: { params: { targetId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const targetId = Number(params.targetId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return NextResponse.json({ error: "측정대상 정보가 올바르지 않습니다.", code: "INVALID_TARGET_ID" }, { status: 400 });
  }

  try {
    const supabase = await createClient();
    if (!await canManagePreliminarySurvey(supabase, session)) {
      return NextResponse.json({ error: "예비조사 담당자 또는 관리자만 계획을 삭제할 수 있습니다." }, { status: 403 });
    }

    const { data: target, error: targetError } = await supabase
      .from("measurement_target_business")
      .select("code, year, period")
      .eq("id", targetId)
      .maybeSingle();
    if (targetError) throw targetError;
    if (!target) return NextResponse.json({ error: "측정대상을 찾을 수 없습니다.", code: "TARGET_NOT_FOUND" }, { status: 404 });

    const { data: plan, error: planError } = await supabase
      .from("preliminary_survey_v2_plans")
      .select("id")
      .eq("measurement_target_business_id", targetId)
      .maybeSingle();
    if (planError) throw planError;
    if (!plan) return deleteErrorResponse("PLAN_NOT_FOUND");

    const { data: journalRows, error: journalError } = await supabase
      .from("measurement_journal")
      .select("measurement_period")
      .eq("code", target.code)
      .eq("measurement_year", target.year);
    if (journalError) throw journalError;
    if ((journalRows ?? []).some((journal) => normalizedPeriod(journal.measurement_period) === normalizedPeriod(target.period))) {
      return deleteErrorResponse("TRUE_CONFIRMED_LOCKED");
    }

    const { data: assignments, error: assignmentError } = await supabase
      .from("preliminary_survey_v2_measurement_assignments")
      .select("id")
      .eq("plan_id", plan.id);
    if (assignmentError) throw assignmentError;
    const assignmentIds = (assignments ?? []).map((assignment) => String(assignment.id));
    const [planReconciliation, assignmentReconciliation, recoveryAudit] = await Promise.all([
      supabase.from("preliminary_survey_v2_legacy_reconciliation").select("id").eq("applied_plan_id", plan.id).limit(1),
      assignmentIds.length > 0
        ? supabase.from("preliminary_survey_v2_legacy_reconciliation").select("id").in("applied_assignment_id", assignmentIds).limit(1)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("preliminary_survey_v2_history_recovery_audit").select("created_plan_id").eq("created_plan_id", plan.id).limit(1),
    ]);
    const protectionError = planReconciliation.error || assignmentReconciliation.error || recoveryAudit.error;
    if (protectionError) throw protectionError;
    if ((planReconciliation.data?.length ?? 0) > 0 ||
        (assignmentReconciliation.data?.length ?? 0) > 0 ||
        (recoveryAudit.data?.length ?? 0) > 0) {
      return deleteErrorResponse("PLAN_DELETE_PROTECTED_HISTORY");
    }

    const body = await request.json().catch(() => ({}));
    const approveThirdAssignment = body.approveThirdAssignment === true;
    const { data, error } = await supabase.rpc("delete_preliminary_survey_v2_plan_and_rebalance_assignments", {
      p_target_id: targetId,
      p_approve_third_assignment: approveThirdAssignment,
      p_approved_by_user_id: approveThirdAssignment ? session.userId : null,
    });
    if (error) return deleteErrorResponse(error.message);

    return NextResponse.json({ success: true, deletedPlan: Array.isArray(data) ? data[0] ?? null : data });
  } catch (error) {
    return deleteErrorResponse(error instanceof Error ? error.message : "PLAN_DELETE_FAILED");
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { targetId: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const targetId = Number(params.targetId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return NextResponse.json({ error: "측정대상 정보가 올바르지 않습니다.", code: "INVALID_TARGET_ID" }, { status: 400 });
    }
    const body = await request.json();
    const participantIds = [...new Set((body.participantUserIds ?? []).map(Number).filter(Number.isFinite))];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.recommendedDate ?? "")) || participantIds.length === 0) {
      return NextResponse.json({
        error: "예비조사일과 예비조사자를 확인해 주세요.",
        code: "INVALID_MANUAL_PLAN_INPUT",
      }, { status: 400 });
    }
    const supabase = await createClient();
    if (!await canManagePreliminarySurvey(supabase, session)) {
      return NextResponse.json({ error: "예비조사 담당자 또는 관리자만 수동 수정할 수 있습니다." }, { status: 403 });
    }
    const { target, users, assignments } = await loadV2ManualContext(supabase, targetId, body.recommendedDate);
    const participants = participantIds.map((id) => users.find((user) => user.id === id))
      .filter((user): user is SurveyUser => Boolean(user));
    if (participants.length !== participantIds.length) {
      return NextResponse.json({ error: "선택한 예비조사자를 찾을 수 없습니다.", code: "PARTICIPANT_NOT_FOUND" }, { status: 400 });
    }
    // 경력+비경력 조합에서는 비경력자가 페이퍼 작성자, 경력자 단독이면 경력자가 작성한다.
    // 측정자/보고서 담당자/link_measurer_id에서는 예비조사 책임자를 추론하지 않는다.
    const responsible = participants.find((user) => !user.experienced) ?? participants[0];
    if (!responsible) return NextResponse.json({ error: "예비조사자를 선택해 주세요.", code: "NO_SURVEYOR" }, { status: 400 });
    const surveyMethod = body.surveyMethod === "field" || body.surveyMethod === "phone"
      ? body.surveyMethod
      : surveyMethodForKind(target.kind);
    const candidateUserIds = contextUsersIds(users);
    const { data: scheduleBlocks, error: scheduleBlockError } = await supabase
      .from("user_schedule_blocks")
      .select("user_id, start_date, end_date")
      .lte("start_date", body.recommendedDate)
      .gte("end_date", body.recommendedDate)
      .in("user_id", candidateUserIds);
    if (scheduleBlockError) throw scheduleBlockError;
    const scheduleBlockedKeys = buildScheduleBlockKeys(scheduleBlocks ?? []);
    const actualMeasurementBlockedKeys = await loadActualMeasurementBlockedKeys(supabase, [body.recommendedDate], users);
    const blockedKeys = new Set([...scheduleBlockedKeys, ...actualMeasurementBlockedKeys]);
    const validationTarget = { ...target, responsible };
    const validation = await validateManualPlanHardRules({
      target: validationTarget, recommendedDate: body.recommendedDate, participants,
      surveyMethod,
      existingAssignments: assignments, routes: createRouteMetrics(),
      experiencedUsers: users.filter((user) => user.experienced),
      availability: {
        isBlocked: (userId, date) => blockedKeys.has(`${userId}:${date}`),
        blockedReason: (userId, date) => {
          const key = `${userId}:${date}`;
          return [
            scheduleBlockedKeys.has(key) ? "USER_SCHEDULE_BLOCK" : null,
            actualMeasurementBlockedKeys.has(key) ? "ACTUAL_MEASUREMENT_CONFLICT" : null,
          ].filter((reason): reason is string => Boolean(reason));
        },
      },
    });
    if (!validation.valid) return NextResponse.json({ error: validation.errors.join(" ") }, { status: 400 });
    if (participantIds.some((userId) => blockedKeys.has(`${userId}:${body.recommendedDate}`))) {
      return NextResponse.json({
        error: "직원 불가 일정에 등록된 예비조사자 또는 경력 검토자는 저장할 수 없습니다.",
        code: "USER_UNAVAILABLE_ON_SURVEY_DATE",
        reviewRequired: true,
      }, { status: 409 });
    }
    // 경력자 2명 이상 조합은 사용자 확인 전에는 저장하지 않는다.
    // 1차 요청(confirm 미포함)에서는 계획을 저장하지 않고 확인 요청만 반환한다.
    const confirmed = body.confirm === true;
    if (validation.requiresUserConfirmation && !confirmed) {
      return NextResponse.json({
        success: false,
        requiresUserConfirmation: true,
        message: "경력자 2명이 예비조사자로 지정되었습니다. 이 조합으로 확정하시겠습니까?",
        recommendedDate: body.recommendedDate,
        participantUserIds: participantIds,
        participantNames: participants.map((user) => user.name),
      });
    }
    const ordered = [...participants].sort((left, right) =>
      Number(right.id === responsible.id) - Number(left.id === responsible.id) || left.id - right.id,
    );
    const canonicalAssignments = await recomputeCanonicalMeasurementAssignments(
      supabase,
      [{ target }],
      new Map([[targetId, ordered.map((user) => user.id)]]),
      false,
    );
    if (canonicalAssignments.schemaMissing) {
      return NextResponse.json({
        error: "측정자·공시료 배정 스키마가 아직 적용되지 않아 수동 수정할 수 없습니다.",
        code: "MEASUREMENT_ASSIGNMENT_SCHEMA_REQUIRED",
        reviewRequired: true,
      }, { status: 409 });
    }
    if (canonicalAssignments.invalidSurveyCodeUserIds.length) {
      return NextResponse.json({
        error: "배정 대상 측정자의 공시료 코드가 사용자 정보에 설정되어 있지 않습니다.",
        code: "MEASUREMENT_ASSIGNMENT_SURVEY_CODE_REQUIRED",
        reviewRequired: true,
      }, { status: 409 });
    }
    if (canonicalAssignments.incompleteTargetIds.length ||
        canonicalAssignments.canonical.length !== canonicalAssignments.expectedAssignmentCount) {
      return NextResponse.json({
        error: "날짜별 측정자(공시료)를 안전하게 배정할 수 없어 저장하지 않았습니다.",
        code: "MEASUREMENT_ASSIGNMENT_INCOMPLETE",
        reviewRequired: true,
      }, { status: 409 });
    }
    if (canonicalAssignments.canonical.some((assignment) => assignment.approvalRequired)) {
      return NextResponse.json({
        error: "측정자 1인 3건 배정은 관리자 CCC 예외 검토에서만 확정할 수 있습니다.",
        code: "MEASUREMENT_ASSIGNMENT_APPROVAL_REQUIRED",
        reviewRequired: true,
      }, { status: 409 });
    }
    const planPayload = [{
      measurement_target_business_id: targetId,
      recommended_date: body.recommendedDate,
      responsible_user_id: responsible.id,
      experienced_reviewer_id: validation.experiencedReviewer?.id ?? null,
      participant_user_ids: ordered.map((user) => user.id),
      participant_names: ordered.map((user) => user.name),
      status: "recommended",
      plan_origin: "manual",
      source_measurement_date: target.measurementDate,
      source_address: target.address ?? null,
      source_daily_staff: target.sourceDailyStaffSnapshot ?? null,
      source_collaborators: target.sourceCollaboratorsSnapshot ?? null,
      source_responsible_user_id: target.sourceMeasurerId,
      source_rule_type: target.kind,
      survey_method: surveyMethod,
      recommendation_reason: {
        reason: "관리자 수동 수정", classificationSource: target.classificationSource, surveyMethod,
      },
      route_evidence: { sameDayRoutes: validation.routeEvidence, validatedAtApply: true },
      warnings: validation.warnings,
    }];
    const assignmentPayload = canonicalAssignments.canonical.map((assignment) => ({
      measurement_target_business_id: assignment.targetId,
      measurement_date: assignment.measurementDate,
      assignee_user_id: assignment.userId,
      survey_code: assignment.surveyCode,
      assignment_reason: assignment.reason,
    }));
    const { data, error } = await supabase.rpc("persist_preliminary_survey_v2_plan_and_assignment_groups", {
      p_plans: planPayload,
      p_assignments: assignmentPayload,
      p_assignment_baseline: canonicalAssignments.baseline,
      p_approve_third_assignment: false,
      p_approved_by_user_id: null,
    });
    if (error) {
      if (isMeasurementAssignmentSchemaMissing(error)) {
        return NextResponse.json({
          error: "측정자·공시료 배정 스키마가 아직 적용되지 않아 수동 수정할 수 없습니다.",
          code: "MEASUREMENT_ASSIGNMENT_SCHEMA_REQUIRED",
          reviewRequired: true,
        }, { status: 409 });
      }
      const message = String(error.message ?? "MANUAL_UPDATE_FAILED");
      return NextResponse.json({
        error: message,
        code: message.includes("TRUE_CONFIRMED_LOCKED") ? "TRUE_CONFIRMED_LOCKED" : "MANUAL_UPDATE_REVIEW_REQUIRED",
        reviewRequired: true,
      }, { status: 409 });
    }
    return NextResponse.json({
      success: true,
      plan: Array.isArray(data) ? data[0] ?? null : data,
      measurementAssignments: canonicalAssignments.canonical,
      requiresUserConfirmation: validation.requiresUserConfirmation,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "MANUAL_UPDATE_FAILED" }, { status: 500 });
  }
}

function contextUsersIds(users: SurveyUser[]) {
  return [...new Set(users.map((user) => user.id).filter((id) => Number.isInteger(id) && id > 0))];
}
