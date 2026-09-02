import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";
import { buildConfirmedDocumentRepairPreview, isCanonicalAutoSurveyorCombination, type RepairMeasurementAssigneeSnapshot } from "@/lib/preliminary-survey-v2/confirmed-document-repair";
import { verifyPreviewToken } from "@/lib/preliminary-survey-v2/reverse-planner/preview-token";

export const dynamic = "force-dynamic";

function targetIdsFrom(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const ids = value.map(Number);
  return ids.length && ids.every((id) => Number.isInteger(id) && id > 0) && new Set(ids).size === ids.length ? ids : null;
}

async function guard() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 }) };
  const supabase = await createClient();
  if (!await canManagePreliminarySurvey(supabase, session)) {
    return { response: NextResponse.json({ error: "예비조사 담당자 또는 관리자만 누락정보를 보정할 수 있습니다." }, { status: 403 }) };
  }
  return { session, supabase };
}

export async function POST(request: NextRequest) {
  try {
    const access = await guard();
    if ("response" in access) return access.response;
    const body = await request.json();
    const targetIds = targetIdsFrom(body.targetIds);
    if (!targetIds) return NextResponse.json({ error: "INVALID_TARGET_IDS" }, { status: 400 });
    let measurementAssigneeSnapshots: RepairMeasurementAssigneeSnapshot[] = Array.isArray(body.measurementAssigneeSnapshots)
      ? body.measurementAssigneeSnapshots.filter((item: any) => Number.isInteger(Number(item?.targetId)) && Number.isInteger(Number(item?.assigneeUserId)))
        .map((item: any) => ({ targetId: Number(item.targetId), measurementDate: String(item.measurementDate ?? ""), assigneeUserId: Number(item.assigneeUserId) }))
      : [];
    if (body.action === "apply") {
      const measurementDate = String(body.measurementDate ?? "");
      const reversePreviewToken = String(body.reversePreviewToken ?? "");
      if (!measurementDate || !reversePreviewToken) {
        return NextResponse.json({ error: "REPAIR_SOURCE_CHANGED", code: "REPAIR_SOURCE_CHANGED" }, { status: 409 });
      }
      const verified = verifyPreviewToken(reversePreviewToken, access.session.userId, measurementDate);
      measurementAssigneeSnapshots = (verified.effectiveMeasurementAssignments ?? []).map((assignment) => ({
        targetId: assignment.targetId,
        measurementDate: assignment.measurementDate,
        assigneeUserId: assignment.assigneeUserId,
      }));
    }
    const preview = await buildConfirmedDocumentRepairPreview(access.supabase, targetIds, measurementAssigneeSnapshots);
    if (body.action === "preview") return NextResponse.json({ success: true, ...preview });
    if (body.action !== "apply") return NextResponse.json({ error: "UNSUPPORTED_ACTION" }, { status: 400 });

    const submitted = (Array.isArray(body.drafts) ? body.drafts : [])
      .sort((left: { targetId: number }, right: { targetId: number }) => Number(left.targetId) - Number(right.targetId));
    const canonical = preview.drafts.filter((draft) => draft.classification === "MISSING_DOCUMENTARY_INFO")
      .sort((left, right) => left.targetId - right.targetId);
    if (JSON.stringify(submitted) !== JSON.stringify(canonical)) {
      return NextResponse.json({ error: "원천값이 변경되었습니다. 누락정보 보정안을 다시 생성해 주세요.", code: "REPAIR_SOURCE_CHANGED" }, { status: 409 });
    }
    if (!canonical.length) return NextResponse.json({ success: true, repairedCount: 0 });
    const participantIds = [...new Set(canonical.flatMap((draft) => draft.participantUserIds.map(Number)))];
    const { data: participantUsers, error: participantError } = await access.supabase
      .from("users")
      .select("id, is_preliminary_survey_experienced")
      .in("id", participantIds);
    if (participantError) throw participantError;
    const usersById = new Map((participantUsers ?? []).map((user: { id: number; is_preliminary_survey_experienced?: boolean | null }) => [
      Number(user.id), { id: Number(user.id), experienced: user.is_preliminary_survey_experienced === true },
    ]));
    const invalidRoleDrafts = canonical.filter((draft) =>
      !isCanonicalAutoSurveyorCombination(
        draft.participantUserIds.map((userId) => usersById.get(Number(userId))),
        draft.responsibleUserId,
        draft.experiencedReviewerUserId,
      ),
    );
    if (invalidRoleDrafts.length) {
      return NextResponse.json({
        error: "비경력자 단독 예비조사 조합은 자동 보정할 수 없습니다.",
        code: "REPAIR_CANONICAL_ROLE_INVALID",
        targetIds: invalidRoleDrafts.map((draft) => draft.targetId),
        repairedCount: 0,
      }, { status: 409 });
    }
    const canonicalTargetIds = canonical.map((draft) => draft.targetId);
    const { data: targetPlans, error: targetPlansError } = await access.supabase
      .from("preliminary_survey_v2_plans")
      .select("id, measurement_target_business_id")
      .in("measurement_target_business_id", canonicalTargetIds);
    if (targetPlansError) throw targetPlansError;
    const planIds = (targetPlans ?? []).map((row: any) => String(row.id));
    const targetByPlanId = new Map((targetPlans ?? []).map((row: any) => [String(row.id), Number(row.measurement_target_business_id)]));
    const [{ data: measurementAssignments, error: measurementAssignmentError }, { data: fixedAssignments, error: fixedAssignmentError }] = await Promise.all([
      planIds.length ? access.supabase.from("preliminary_survey_v2_measurement_assignments")
        .select("plan_id, assignee_user_id")
        .in("plan_id", planIds) : Promise.resolve({ data: [], error: null }),
      access.supabase.from("preliminary_survey_v2_fixed_assignments")
        .select("measurement_target_business_id, assignee_user_id")
        .in("measurement_target_business_id", canonicalTargetIds),
    ]);
    if (measurementAssignmentError) throw measurementAssignmentError;
    if (fixedAssignmentError) throw fixedAssignmentError;
    const assigneesByTarget = new Map<number, Set<number>>();
    for (const row of measurementAssignments ?? []) {
      const key = targetByPlanId.get(String(row.plan_id));
      if (key == null) continue;
      const values = assigneesByTarget.get(key) ?? new Set<number>();
      values.add(Number(row.assignee_user_id));
      assigneesByTarget.set(key, values);
    }
    for (const row of fixedAssignments ?? []) {
      const key = Number(row.measurement_target_business_id);
      const values = assigneesByTarget.get(key) ?? new Set<number>();
      values.add(Number(row.assignee_user_id));
      assigneesByTarget.set(key, values);
    }
    const missingMeasurementAssignee = canonical.filter((draft) => {
      const assignees = assigneesByTarget.get(draft.targetId) ?? new Set<number>();
      return !draft.participantUserIds.some((id) => assignees.has(Number(id)));
    });
    if (missingMeasurementAssignee.length) {
      return NextResponse.json({
        error: "측정자(공시료 담당자)가 예비조사자에 포함되어야 합니다.",
        code: "REPAIR_MEASUREMENT_ASSIGNEE_REQUIRED",
        targetIds: missingMeasurementAssignee.map((draft) => draft.targetId),
        repairedCount: 0,
      }, { status: 409 });
    }
    const { data, error } = await access.supabase.rpc("repair_true_confirmed_preliminary_v2_missing_batch", {
      p_repairs: canonical,
      p_changed_by_user_id: access.session.userId,
    });
    if (error) {
      const status = /SOURCE_CHANGED|NON_NULL_OVERWRITE|PROTECTED|TRUE_CONFIRMED/.test(error.message) ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.message }, { status });
    }
    return NextResponse.json({ success: true, repairedCount: Number(data) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CONFIRMED_REPAIR_FAILED" }, { status: 500 });
  }
}
