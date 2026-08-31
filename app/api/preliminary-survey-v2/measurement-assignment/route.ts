import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";

export const dynamic = "force-dynamic";

type ThirdAssignmentReview = {
  fingerprint: string;
  measurementDate: string;
  assigneeUserId: number;
  assigneeName: string;
  items: Array<{ targetId: number; businessName: string; address: string; previousSurveyCode: string | null; resultSurveyCode: string }>;
};

function assignmentError(message: string, approvalReview?: ThirdAssignmentReview | null) {
  if (message.includes("MEASUREMENT_ASSIGNMENT_ADMIN_EXCEPTION_REQUIRED")) {
    return NextResponse.json({
      error: "같은 측정일 동일 담당자 3건은 관리자 확인이 필요합니다.",
      code: "MEASUREMENT_ASSIGNMENT_ADMIN_EXCEPTION_REQUIRED",
      approvalRequired: true,
      approvalReview: approvalReview ?? null,
    }, { status: 409 });
  }
  if (message.includes("MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED")) {
    return NextResponse.json({ error: "같은 측정일 동일 담당자 4건 이상은 일반 경로에서 배정할 수 없습니다.", code: "MEASUREMENT_ASSIGNMENT_HARD_MAX_EXCEEDED" }, { status: 409 });
  }
  if (message.includes("TRUE_CONFIRMED_LOCKED")) {
    return NextResponse.json({ error: "찐확정 사업장의 공시료는 일반 수정할 수 없습니다.", code: "TRUE_CONFIRMED_LOCKED" }, { status: 409 });
  }
  if (message.includes("MEASUREMENT_ASSIGNMENT_SOURCE_CHANGED")) {
    return NextResponse.json({ error: "공시료 원천이 변경되었습니다. 새로고침 후 다시 시도해 주세요.", code: "MEASUREMENT_ASSIGNMENT_SOURCE_CHANGED" }, { status: 409 });
  }
  if (message.includes("MEASUREMENT_ASSIGNMENT_USER_SCHEDULE_BLOCKED")) {
    return NextResponse.json({ error: "선택한 측정자는 해당 측정일에 직원 불가 일정이 있습니다.", code: "MEASUREMENT_ASSIGNMENT_USER_SCHEDULE_BLOCKED" }, { status: 409 });
  }
  if (message.includes("MEASUREMENT_ASSIGNMENT_ASSIGNEE_UNCHANGED")) {
    return NextResponse.json({ error: "현재 공시료 담당자와 동일합니다.", code: "MEASUREMENT_ASSIGNMENT_ASSIGNEE_UNCHANGED" }, { status: 400 });
  }
  if (message.includes("ADMIN_OVERRIDE_FORBIDDEN") || message.includes("FORBIDDEN")) {
    return NextResponse.json({ error: "공시료 수정 권한이 없습니다.", code: "FORBIDDEN" }, { status: 403 });
  }
  return NextResponse.json({ error: message || "MEASUREMENT_ASSIGNMENT_MANUAL_EDIT_FAILED" }, { status: 409 });
}

function approvalFingerprint(measurementDate: string, assigneeUserId: number, targetIds: number[]) {
  return createHash("md5").update(`${measurementDate}|${assigneeUserId}|${[...targetIds].sort((a, b) => a - b).join(",")}`).digest("hex");
}

async function loadThirdAssignmentReview(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assignmentId: string,
  assigneeUserId: number,
  expectedFingerprint: string,
): Promise<ThirdAssignmentReview | null> {
  const { data: sourceAssignment } = await supabase.from("preliminary_survey_v2_measurement_assignments")
    .select("id, plan_id, measurement_date, survey_code").eq("id", assignmentId).maybeSingle();
  if (!sourceAssignment) return null;
  const measurementDate = String(sourceAssignment.measurement_date);
  const { data: sourcePlan } = await supabase.from("preliminary_survey_v2_plans")
    .select("id, measurement_target_business_id").eq("id", sourceAssignment.plan_id).maybeSingle();
  if (!sourcePlan) return null;
  const { data: destinationAssignments } = await supabase.from("preliminary_survey_v2_measurement_assignments")
    .select("id, plan_id, survey_code").eq("measurement_date", measurementDate).eq("assignee_user_id", assigneeUserId);
  const planIds = [...new Set([
    String(sourcePlan.id),
    ...(destinationAssignments ?? []).map((assignment: any) => String(assignment.plan_id)),
  ])];
  const { data: plans } = await supabase.from("preliminary_survey_v2_plans")
    .select("id, measurement_target_business_id").in("id", planIds);
  const targetIdByPlanId = new Map((plans ?? []).map((plan: any) => [String(plan.id), Number(plan.measurement_target_business_id)]));
  const targetIds = [...new Set([
    Number(sourcePlan.measurement_target_business_id),
    ...(destinationAssignments ?? []).map((assignment: any) => targetIdByPlanId.get(String(assignment.plan_id)) ?? 0),
  ].filter((targetId) => targetId > 0))].sort((a, b) => a - b);
  if (targetIds.length !== 3 || approvalFingerprint(measurementDate, assigneeUserId, targetIds) !== expectedFingerprint) return null;
  const [{ data: targets }, { data: assignee }] = await Promise.all([
    supabase.from("measurement_target_business").select("id, business_name, address").in("id", targetIds),
    supabase.from("users").select("id, name, survey_code").eq("id", assigneeUserId).maybeSingle(),
  ]);
  const targetById = new Map((targets ?? []).map((target: any) => [Number(target.id), target]));
  const previousCodeByTargetId = new Map<number, string | null>();
  previousCodeByTargetId.set(Number(sourcePlan.measurement_target_business_id), String(sourceAssignment.survey_code ?? "") || null);
  for (const assignment of destinationAssignments ?? []) {
    const targetId = targetIdByPlanId.get(String((assignment as any).plan_id));
    if (targetId != null) previousCodeByTargetId.set(targetId, String((assignment as any).survey_code ?? "") || null);
  }
  const baseCode = String(assignee?.survey_code ?? "").trim().toUpperCase();
  return {
    fingerprint: expectedFingerprint,
    measurementDate,
    assigneeUserId,
    assigneeName: String(assignee?.name ?? `ID ${assigneeUserId}`),
    items: targetIds.map((targetId, index) => {
      const target: any = targetById.get(targetId);
      return {
        targetId,
        businessName: String(target?.business_name ?? `대상 ${targetId}`),
        address: String(target?.address ?? "-") || "-",
        previousSurveyCode: previousCodeByTargetId.get(targetId) ?? null,
        resultSurveyCode: baseCode.repeat(index + 1),
      };
    }),
  };
}

async function adminPolicyWarnings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  targetId: number,
  measurementDate: string,
  assigneeUserId: number,
  assignmentId: string,
) {
  const warnings: string[] = [];
  const [{ data: plan }, { data: scheduleBlocks }, { data: sameDayAssignments }] = await Promise.all([
    supabase.from("preliminary_survey_v2_plans")
      .select("participant_user_ids")
      .eq("measurement_target_business_id", targetId)
      .maybeSingle(),
    supabase.from("user_schedule_blocks")
      .select("id")
      .eq("user_id", assigneeUserId)
      .lte("start_date", measurementDate)
      .gte("end_date", measurementDate)
      .limit(1),
    supabase.from("preliminary_survey_v2_measurement_assignments")
      .select("id")
      .eq("measurement_date", measurementDate)
      .eq("assignee_user_id", assigneeUserId),
  ]);
  const participantIds = Array.isArray(plan?.participant_user_ids) ? plan.participant_user_ids.map(Number) : [];
  if (participantIds.length > 0 && !participantIds.includes(assigneeUserId)) {
    warnings.push("예비조사자와 측정자(공시료)가 일치하지 않습니다.");
  }
  if ((scheduleBlocks ?? []).length > 0) {
    warnings.push("선택한 측정자에게 해당 측정일 직원 불가 일정이 있습니다.");
  }
  const sameDayCount = (sameDayAssignments ?? []).filter((assignment: any) => String(assignment.id) !== assignmentId).length + 1;
  if (sameDayCount >= 3) {
    warnings.push(`동일 측정일 동일 측정자 ${sameDayCount}건 배정입니다. 자동추천 한도(2건)를 초과합니다.`);
  }
  return [...new Set(warnings)];
}

/** 날짜별 공시료 담당자 수동 수정. 관리자는 찐확정/지침 예외도 경고 확인 후 직접 지정할 수 있다. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const body = await request.json();
    const assignmentId = String(body.assignmentId ?? "").trim();
    const targetId = Number(body.targetId);
    const expectedMeasurementDate = String(body.expectedMeasurementDate ?? "").trim();
    const expectedAssigneeUserId = Number(body.expectedAssigneeUserId);
    const assigneeUserId = Number(body.assigneeUserId);
    const reason = String(body.reason ?? "").trim();
    const confirm = body.confirm === true;
    const approveThirdAssignment = body.approveThirdAssignment === true;
    const expectedApprovalGroupFingerprint = String(body.expectedApprovalGroupFingerprint ?? "").trim() || null;
    if (!/^[0-9a-f-]{36}$/i.test(assignmentId) || !Number.isInteger(targetId) || targetId <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(expectedMeasurementDate) ||
        !Number.isInteger(expectedAssigneeUserId) || expectedAssigneeUserId <= 0 ||
        !Number.isInteger(assigneeUserId) || assigneeUserId <= 0 || !reason) {
      return NextResponse.json({ error: "수정할 사업장·날짜·담당자·사유를 확인해 주세요.", code: "INVALID_MEASUREMENT_ASSIGNMENT_MANUAL_EDIT" }, { status: 400 });
    }
    const supabase = await createClient();
    if (!await canManagePreliminarySurvey(supabase, session)) {
      return NextResponse.json({ error: "관리자 또는 예비조사 담당자만 공시료를 수정할 수 있습니다.", code: "FORBIDDEN" }, { status: 403 });
    }

    if (session.role === "관리자") {
      const policyWarnings = await adminPolicyWarnings(
        supabase, targetId, expectedMeasurementDate, assigneeUserId, assignmentId,
      );
      if (policyWarnings.length > 0 && !confirm) {
        return NextResponse.json({
          success: false,
          requiresUserConfirmation: true,
          policyWarnings,
          message: `운영지침 위반/주의 사항:\n- ${policyWarnings.join("\n- ")}\n\n관리자 판단으로 그대로 저장하시겠습니까?`,
        });
      }
      const { data, error } = await supabase.rpc("admin_override_preliminary_survey_v2_measurement_assignment", {
        p_target_id: targetId,
        p_measurement_date: expectedMeasurementDate,
        p_expected_assignee_user_id: expectedAssigneeUserId,
        p_assignee_user_id: assigneeUserId,
        p_policy_warnings: policyWarnings,
        p_changed_by_user_id: session.userId,
      });
      if (error) return assignmentError(String(error.message ?? "ADMIN_MEASUREMENT_ASSIGNMENT_OVERRIDE_FAILED"));
      return NextResponse.json({
        success: true,
        assignment: Array.isArray(data) ? data[0] ?? null : data,
        adminOverride: true,
        policyWarnings,
      });
    }

    if (approveThirdAssignment) {
      return NextResponse.json({ error: "공시료 3건 예외는 관리자만 승인할 수 있습니다.", code: "MEASUREMENT_ASSIGNMENT_ADMIN_EXCEPTION_REQUIRED" }, { status: 403 });
    }
    const { data, error } = await supabase.rpc("update_preliminary_survey_v2_measurement_assignment", {
      p_assignment_id: assignmentId,
      p_expected_measurement_date: expectedMeasurementDate,
      p_expected_assignee_user_id: expectedAssigneeUserId,
      p_assignee_user_id: assigneeUserId,
      p_reason: reason,
      p_changed_by_user_id: session.userId,
      p_approve_third_assignment: approveThirdAssignment,
      p_expected_approval_group_fingerprint: expectedApprovalGroupFingerprint,
    });
    if (error) {
      const message = String(error.message ?? "MEASUREMENT_ASSIGNMENT_MANUAL_EDIT_FAILED");
      const fingerprint = message.match(/MEASUREMENT_ASSIGNMENT_ADMIN_EXCEPTION_REQUIRED:([a-f0-9]{32})/i)?.[1] ?? null;
      const review = fingerprint
        ? await loadThirdAssignmentReview(supabase, assignmentId, assigneeUserId, fingerprint)
        : null;
      if (fingerprint && !review) return assignmentError("MEASUREMENT_ASSIGNMENT_SOURCE_CHANGED");
      return assignmentError(message, review);
    }
    return NextResponse.json({ success: true, assignment: Array.isArray(data) ? data[0] ?? null : data });
  } catch (error) {
    return assignmentError(error instanceof Error ? error.message : "MEASUREMENT_ASSIGNMENT_MANUAL_EDIT_FAILED");
  }
}
