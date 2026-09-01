import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { canManagePreliminarySurvey } from "@/lib/preliminary-survey-v2/access";
import { measurementDayFormsFrom } from "@/lib/business/measurement-day-form";
import { createRouteMetrics } from "@/lib/preliminary-survey-v2/route-metrics";
import { candidateDates } from "@/lib/preliminary-survey-v2/reverse-planner/candidate-dates";
import { sourceFingerprint } from "@/lib/preliminary-survey-v2/reverse-planner/fingerprint";
import { buildPlanningSnapshot } from "@/lib/preliminary-survey-v2/reverse-planner/snapshot";
import { planPreliminarySurveyGivenFixedAssignments, validateCandidateForSave } from "@/lib/preliminary-survey-v2/reverse-planner/solver";
import type { PlannerCandidate, PlanningSnapshot } from "@/lib/preliminary-survey-v2/reverse-planner/types";

export const dynamic = "force-dynamic";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function schemaMissing(error: any) {
  return ["42P01", "42703", "PGRST202", "PGRST205"].includes(String(error?.code ?? ""))
    || /preliminary_survey_v2_fixed_assignments|public_sample_code|reverse_planner/i.test(String(error?.message ?? ""));
}

function subtractDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

async function routeEvidenceFor(
  targets: any[],
  businessInfo: any[],
  planningTargetIds: number[],
): Promise<PlanningSnapshot["routeEvidence"]> {
  const infoByCode = new Map(businessInfo.map((row) => [String(row.code), row]));
  const planningIds = new Set(planningTargetIds);
  const routes = createRouteMetrics();
  const capturedAt = new Date().toISOString();
  const result: PlanningSnapshot["routeEvidence"] = [];
  const pairs: Array<[any, any]> = [];
  for (let leftIndex = 0; leftIndex < targets.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < targets.length; rightIndex += 1) {
      const left = targets[leftIndex];
      const right = targets[rightIndex];
      if (!planningIds.has(Number(left.id)) && !planningIds.has(Number(right.id))) continue;
      pairs.push([left, right]);
    }
  }
  let nextPair = 0;
  const worker = async () => {
    while (nextPair < pairs.length) {
      const pairIndex = nextPair;
      nextPair += 1;
      const [left, right] = pairs[pairIndex];
      const leftInfo = infoByCode.get(String(left.code));
      const rightInfo = infoByCode.get(String(right.code));
      const coordinate = (row: any) => Number.isFinite(Number(row?.latitude)) && Number.isFinite(Number(row?.longitude))
        ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : null;
      const region = (address: unknown) => String(address ?? "").trim().split(/\s+/).slice(0, 2).join(" ") || null;
      const metric = await routes.between(
        { coordinate: coordinate(leftInfo), region: region(left.address) } as any,
        { coordinate: coordinate(rightInfo), region: region(right.address) } as any,
      );
      const leftDays = measurementDayFormsFrom({
        dailyStaff: left.daily_staff, measurementDate: left.measurement_date,
        measurerId: left.measurer_id, collaborators: left.collaborators,
      }).map((day) => day.date);
      const rightDays = measurementDayFormsFrom({
        dailyStaff: right.daily_staff, measurementDate: right.measurement_date,
        measurerId: right.measurer_id, collaborators: right.collaborators,
      }).map((day) => day.date);
      const preliminaryDates = [...new Set([
        ...candidateDates(leftDays[0] ?? "", left.business_type === "first_measurement" ? "first_measurement" : left.business_type === "external_new" ? "external_new" : "existing").primary,
        ...candidateDates(leftDays[0] ?? "", left.business_type === "first_measurement" ? "first_measurement" : left.business_type === "external_new" ? "external_new" : "existing").fallback,
        ...candidateDates(rightDays[0] ?? "", right.business_type === "first_measurement" ? "first_measurement" : right.business_type === "external_new" ? "external_new" : "existing").primary,
        ...candidateDates(rightDays[0] ?? "", right.business_type === "first_measurement" ? "first_measurement" : right.business_type === "external_new" ? "external_new" : "existing").fallback,
        ...leftDays.filter((date) => rightDays.includes(date)),
      ])].sort();
      for (const date of preliminaryDates) {
        result.push({
          date,
          leftTargetId: Number(left.id),
          rightTargetId: Number(right.id),
          sameAddress: Boolean(String(left.address ?? "").trim()
            && String(left.address ?? "").trim() === String(right.address ?? "").trim()),
          durationMinutes: metric.source === "vehicle" ? metric.durationMinutes : null,
          provider: metric.source,
          capturedAt,
        });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, pairs.length) }, () => worker()));
  return result.sort((left, right) => left.date.localeCompare(right.date)
    || left.leftTargetId - right.leftTargetId || left.rightTargetId - right.rightTargetId);
}

async function loadSnapshot(supabase: any, measurementDate: string) {
  const year = Number(measurementDate.slice(0, 4));
  const { data: candidates, error: targetError } = await supabase
    .from("measurement_target_business")
    .select("id, code, year, period, business_name, address, measurement_date, measurement_end_date, daily_staff, collaborators, measurer_id, business_type, preliminary_survey_rule_type")
    .in("year", [year - 1, year, year + 1]);
  if (targetError) throw targetError;
  const measurementDays = (target: any) => measurementDayFormsFrom({
      dailyStaff: target.daily_staff,
      measurementDate: target.measurement_date,
      measurerId: target.measurer_id,
      collaborators: target.collaborators,
    });
  const planningTargets = (candidates ?? []).filter((target: any) =>
    measurementDays(target).some((day) => day.date === measurementDate));
  const planningTargetIds = planningTargets.map((target: any) => Number(target.id));
  const planningDates = [...new Set<string>(planningTargets.flatMap((target: any) => measurementDays(target).map((day) => String(day.date))))].sort();
  const earliestMeasurementDate = planningDates[0] ?? measurementDate;
  const latestMeasurementDate = planningDates.at(-1) ?? measurementDate;
  const candidateRangeStart = subtractDays(earliestMeasurementDate, 45);
  const occupancyTargets = (candidates ?? []).filter((target: any) => measurementDays(target)
    .some((day) => day.date >= candidateRangeStart && day.date <= latestMeasurementDate));
  const occupancyTargetIds = occupancyTargets.map((target: any) => Number(target.id));
  const codes = [...new Set((candidates ?? []).map((target: any) => String(target.code)))];
  const [{ data: users, error: userError }, fixedResult, rangePlanResult, planningPlanResult, scheduleResult, infoResult, journalResult, publicGroupResult] = await Promise.all([
    supabase.from("users").select("id, name, is_active, is_preliminary_survey_experienced, survey_code").eq("job", "측정"),
    occupancyTargetIds.length
      ? supabase.from("preliminary_survey_v2_fixed_assignments").select("*").in("measurement_target_business_id", occupancyTargetIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("preliminary_survey_v2_plans").select("*")
      .gte("recommended_date", candidateRangeStart).lte("recommended_date", latestMeasurementDate),
    planningTargetIds.length
      ? supabase.from("preliminary_survey_v2_plans").select("*").in("measurement_target_business_id", planningTargetIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("user_schedule_blocks").select("user_id, start_date, end_date")
      .lte("start_date", latestMeasurementDate).gte("end_date", candidateRangeStart),
    codes.length
      ? supabase.from("business_info").select("code, latitude, longitude").in("code", codes)
      : Promise.resolve({ data: [], error: null }),
    codes.length
      ? supabase.from("measurement_journal").select("code, measurement_year, measurement_period").in("code", codes)
      : Promise.resolve({ data: [], error: null }),
    planningDates.length
      ? supabase.from("preliminary_survey_v2_measurement_assignments")
        .select("plan_id, measurement_date, assignee_user_id, survey_code, public_sample_code").in("measurement_date", planningDates)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const firstError = userError || fixedResult.error || rangePlanResult.error || planningPlanResult.error
    || scheduleResult.error || infoResult.error || journalResult.error || publicGroupResult.error;
  if (firstError) throw firstError;
  const preliminaryPlans = [...(rangePlanResult.data ?? []), ...(planningPlanResult.data ?? [])];
  const publicGroupPlanIds = [...new Set<string>((publicGroupResult.data ?? []).map((assignment: any) => String(assignment.plan_id)))];
  const knownPlanIds = new Set(preliminaryPlans.map((plan: any) => String(plan.id)));
  const missingPlanIds = publicGroupPlanIds.filter((id) => !knownPlanIds.has(id));
  const missingPlanResult = missingPlanIds.length
    ? await supabase.from("preliminary_survey_v2_plans").select("*").in("id", missingPlanIds)
    : { data: [], error: null };
  if (missingPlanResult.error) throw missingPlanResult.error;
  const plans = [...new Map([...preliminaryPlans, ...(missingPlanResult.data ?? [])]
    .map((plan: any) => [String(plan.id), plan])).values()];
  const planTargetIds = new Set(plans.map((plan: any) => Number(plan.measurement_target_business_id)));
  const snapshotTargets = [...new Map([
    ...occupancyTargets,
    ...(candidates ?? []).filter((target: any) => planTargetIds.has(Number(target.id))),
  ].map((target: any) => [Number(target.id), target])).values()];
  const planIds = plans.map((plan: any) => String(plan.id));
  const { data: planAssignments, error: assignmentError } = planIds.length
    ? await supabase.from("preliminary_survey_v2_measurement_assignments")
      .select("plan_id, measurement_date, assignee_user_id, survey_code, public_sample_code").in("plan_id", planIds)
    : { data: [], error: null };
  if (assignmentError) throw assignmentError;
  const assignments = [...new Map([...(planAssignments ?? []), ...(publicGroupResult.data ?? [])]
    .map((assignment: any) => [`${assignment.plan_id}|${assignment.measurement_date}`, assignment])).values()];
  const [reconciliationResult, historyResult] = planIds.length ? await Promise.all([
    supabase.from("preliminary_survey_v2_legacy_reconciliation").select("applied_plan_id").in("applied_plan_id", planIds),
    supabase.from("preliminary_survey_v2_history_recovery_audit").select("created_plan_id").in("created_plan_id", planIds),
  ]) : [{ data: [], error: null }, { data: [], error: null }];
  if (reconciliationResult.error || historyResult.error) throw reconciliationResult.error || historyResult.error;
  const protectedPlanIds = new Set([
    ...(reconciliationResult.data ?? []).map((row: any) => String(row.applied_plan_id)),
    ...(historyResult.data ?? []).map((row: any) => String(row.created_plan_id)),
  ]);
  const normalizedPeriod = (value: unknown) => String(value ?? "").trim().replace("(수시)", "");
  const journalKeys = new Set((journalResult.data ?? []).map((row: any) =>
    `${row.code}|${row.measurement_year}|${normalizedPeriod(row.measurement_period)}`
  ));
  const protectedTargetIds = snapshotTargets.filter((target: any) =>
    journalKeys.has(`${target.code}|${target.year}|${normalizedPeriod(target.period)}`)
    || protectedPlanIds.has(String(plans.find((plan: any) => Number(plan.measurement_target_business_id) === Number(target.id))?.id ?? ""))
  ).map((target: any) => Number(target.id));
  const routeEvidence = await routeEvidenceFor(snapshotTargets, infoResult.data ?? [], planningTargetIds);
  return {
    snapshot: buildPlanningSnapshot({
      targets: snapshotTargets,
      users: users ?? [],
      fixedAssignments: fixedResult.data ?? [],
      plans,
      assignments,
      scheduleBlocks: scheduleResult.data ?? [],
      routeEvidence,
      trueConfirmedTargetIds: protectedTargetIds,
      planningTargetIds,
    }),
    rawTargets: planningTargets,
  };
}

async function authorize() {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  const supabase = await createClient();
  if (!await canManagePreliminarySurvey(supabase, session)) throw new Error("FORBIDDEN");
  return { session, supabase };
}

function responseError(error: unknown) {
  const value = error as any;
  const message = value instanceof Error ? value.message : String(value?.message ?? value);
  if (message === "UNAUTHORIZED") return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (message === "FORBIDDEN") return NextResponse.json({ error: "예비조사 담당자 또는 관리자만 사용할 수 있습니다." }, { status: 403 });
  if (schemaMissing(value)) return NextResponse.json({ error: "역산 플래너 DB migration이 필요합니다.", code: "PLANNER_SCHEMA_REQUIRED" }, { status: 503 });
  return NextResponse.json({ error: message || "REVERSE_PLANNER_FAILED" }, { status: 500 });
}

export async function GET(request: NextRequest) {
  try {
    const measurementDate = new URL(request.url).searchParams.get("measurementDate") ?? "";
    if (!DATE_ONLY.test(measurementDate)) return NextResponse.json({ error: "실제 측정일이 필요합니다." }, { status: 400 });
    const { session, supabase } = await authorize();
    const { snapshot } = await loadSnapshot(supabase, measurementDate);
    return NextResponse.json({ snapshot, sourceFingerprint: sourceFingerprint(snapshot), canOverride: session.role === "관리자" });
  } catch (error) {
    return responseError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { session, supabase } = await authorize();
    const body = await request.json();
    const measurementDate = String(body.measurementDate ?? "");
    if (!DATE_ONLY.test(measurementDate)) return NextResponse.json({ error: "실제 측정일이 필요합니다." }, { status: 400 });
    const { snapshot } = await loadSnapshot(supabase, measurementDate);

    if (body.action === "confirm_fixed") {
      const targetId = Number(body.targetId);
      const fixedDate = String(body.fixedDate ?? "");
      const assigneeUserId = Number(body.assigneeUserId);
      if (!Number.isInteger(targetId) || !DATE_ONLY.test(fixedDate) || !Number.isInteger(assigneeUserId)) {
        return NextResponse.json({ error: "고정 측정자 확정값이 올바르지 않습니다." }, { status: 400 });
      }
      const target = snapshot.targets.find((item) => item.id === targetId);
      const day = target?.days.find((item) => item.date === fixedDate);
      if (!target || !day) {
        return NextResponse.json({ error: "해당 사업장의 실제 측정일이 아닙니다." }, { status: 400 });
      }
      if (target.days.some((day) => day.date.startsWith("2026-08-"))) {
        return NextResponse.json({ error: "2026년 8월 실제 측정자료는 새 플래너로 확정하지 않습니다.", code: "TRANSITION_BOUNDARY_REVIEW_REQUIRED" }, { status: 409 });
      }
      const nonParticipant = !day.collaboratorUserIds.includes(assigneeUserId);
      if (nonParticipant && body.nonParticipantConfirmed !== true) {
        return NextResponse.json({
          error: "측정 참여자에 포함되지 않은 측정자입니다. 명시 확인 후 다시 요청해 주세요.",
          code: "NON_PARTICIPANT_ASSIGNEE_CONFIRMATION_REQUIRED",
        }, { status: 409 });
      }
      const fingerprint = sourceFingerprint(snapshot);
      const { data, error } = await supabase.rpc("confirm_preliminary_survey_v2_fixed_assignment", {
        p_target_id: targetId,
        p_measurement_date: fixedDate,
        p_assignee_user_id: assigneeUserId,
        p_actor_user_id: session.userId,
        p_confirmation_path: "planner_ui",
        p_source_fingerprint: fingerprint,
        p_source_snapshot: { ...target, nonParticipantConfirmed: nonParticipant && body.nonParticipantConfirmed === true },
      });
      if (error) throw error;
      return NextResponse.json({ success: true, fixedAssignment: Array.isArray(data) ? data[0] : data });
    }

    const output = planPreliminarySurveyGivenFixedAssignments(snapshot);
    if (body.action === "preview") return NextResponse.json(output);
    if (body.action === "override") {
      if (session.role !== "관리자") {
        return NextResponse.json({ error: "관리자만 예외 저장할 수 있습니다." }, { status: 403 });
      }
      if (String(body.sourceFingerprint ?? "") !== output.sourceFingerprint) {
        return NextResponse.json({ error: "원천이 변경되어 저장하지 않았습니다.", code: "SOURCE_CHANGED", appliedCount: 0 }, { status: 409 });
      }
      const targetId = Number(body.targetId);
      const target = snapshot.targets.find((item) => item.id === targetId);
      const preliminaryDate = String(body.preliminaryDate ?? "");
      const participantUserIds = Array.isArray(body.participantUserIds)
        ? [...new Set<number>(body.participantUserIds.map(Number).filter((id: number) => Number.isInteger(id) && id > 0))]
        : [];
      const responsibleUserId = Number(body.responsibleUserId);
      const reviewerUserId = body.reviewerUserId == null || body.reviewerUserId === "" ? null : Number(body.reviewerUserId);
      const surveyMethod = body.surveyMethod === "phone" ? "phone" : body.surveyMethod === "field" ? "field" : null;
      const overrideReason = String(body.overrideReason ?? "").trim();
      const activeUserIds = new Set(snapshot.users.filter((user) => user.active).map((user) => user.id));
      if (!target || !DATE_ONLY.test(preliminaryDate) || !surveyMethod || !overrideReason
          || !participantUserIds.length || !participantUserIds.every((id) => activeUserIds.has(id))
          || !participantUserIds.includes(responsibleUserId)
          || (reviewerUserId != null && !participantUserIds.includes(reviewerUserId))
          || target.fixedAssignments.length !== target.days.length) {
        return NextResponse.json({ error: "관리자 override 입력 또는 원천 구조가 올바르지 않습니다." }, { status: 400 });
      }
      const result = output.results.find((item) => item.targetId === targetId)!;
      const userById = new Map(snapshot.users.map((user) => [user.id, user]));
      const overrideWriter = snapshot.users.find((user) => participantUserIds.includes(user.id) && !user.experienced)
        ?? snapshot.users.find((user) => participantUserIds.includes(user.id) && user.experienced);
      const overrideCandidate: PlannerCandidate = {
        preliminaryDate,
        surveyMethod,
        participantUserIds,
        responsibleUserId,
        reviewerUserId,
        writerUserId: overrideWriter?.id ?? responsibleUserId,
        objective: [0, 0, 0, 0, 0, 0] as const,
        reasons: ["ADMIN_EXPLICIT_OVERRIDE"],
      };
      const violations = [...new Set([
        ...(result.reason ? [result.reason] : []),
        ...validateCandidateForSave(snapshot, target, overrideCandidate),
      ])].sort();
      const acknowledgedViolations = Array.isArray(body.acknowledgedViolations)
        ? [...new Set(body.acknowledgedViolations.map(String))].sort()
        : [];
      if (JSON.stringify(acknowledgedViolations) !== JSON.stringify(violations)) {
        return NextResponse.json({
          error: "관리자 예외 위반사항을 확인해 주세요.",
          code: "MANUAL_OVERRIDE_CONFIRMATION_REQUIRED",
          violations,
          appliedCount: 0,
        }, { status: 409 });
      }
      const plannerRunId = crypto.randomUUID();
      const plan = {
        target_id: target.id,
        decision: "MANUAL_OVERRIDE",
        mutation: target.existingPlan ? "REPLACE" : "CREATE",
        preliminary_date: preliminaryDate,
        responsible_user_id: responsibleUserId,
        reviewer_user_id: reviewerUserId,
        participant_user_ids: participantUserIds,
        participant_names: participantUserIds.map((id) => userById.get(id)?.name).filter(Boolean),
        source_measurement_date: target.sourceMeasurementDate,
        source_report_writer_id: target.sourceReportWriterUserId,
        source_collaborators: target.sourceCollaborators ?? null,
        source_daily_staff: target.sourceDailyStaff ?? null,
        source_rule_type: target.businessType === "existing" ? "existing" : "new",
        survey_method: surveyMethod,
        reasons: ["ADMIN_EXPLICIT_OVERRIDE"],
        warnings: violations,
        route_evidence: snapshot.routeEvidence.filter((item) => item.leftTargetId === target.id || item.rightTargetId === target.id),
        before_snapshot: target.existingPlan ?? {},
        actual_measurement_team: target.days,
        fixed_assignments: target.fixedAssignments,
      };
      const assignments = result.publicSampleAssignments.map((assignment) => ({
        target_id: assignment.targetId,
        measurement_date: assignment.measurementDate,
        assignee_user_id: assignment.assigneeUserId,
        survey_code: assignment.surveyCode,
        public_sample_code: assignment.publicSampleCode,
      }));
      const { data, error } = await supabase.rpc("apply_preliminary_survey_v2_reverse_planner", {
        p_planner_run_id: plannerRunId,
        p_source_fingerprint: output.sourceFingerprint,
        p_canonical_sha: output.canonicalSha,
        p_planner_version: output.plannerVersion,
        p_plans: [plan],
        p_assignments: assignments,
        p_actor_user_id: session.userId,
        p_override_reason: overrideReason,
      });
      if (error) throw error;
      return NextResponse.json({ success: true, ...data });
    }
    if (body.action !== "apply") return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
    if (String(body.sourceFingerprint ?? "") !== output.sourceFingerprint) {
      return NextResponse.json({ error: "원천이 변경되어 적용하지 않았습니다.", code: "SOURCE_CHANGED", appliedCount: 0 }, { status: 409 });
    }
    const applicable = output.results.filter((result) => result.decision === "AUTO_ASSIGNED"
      && (result.mutation === "CREATE" || result.mutation === "REPLACE"));
    const userById = new Map(snapshot.users.map((user) => [user.id, user]));
    const targetById = new Map(snapshot.targets.map((target) => [target.id, target]));
    const plans = applicable.map((result) => {
      const target = targetById.get(result.targetId)!;
      const candidate = result.candidate!;
      return {
        target_id: target.id,
        decision: result.decision,
        mutation: result.mutation,
        preliminary_date: candidate.preliminaryDate,
        responsible_user_id: candidate.responsibleUserId,
        reviewer_user_id: candidate.reviewerUserId,
        participant_user_ids: candidate.participantUserIds,
        participant_names: candidate.participantUserIds.map((id) => userById.get(id)?.name).filter(Boolean),
        source_measurement_date: target.sourceMeasurementDate,
        source_report_writer_id: target.sourceReportWriterUserId,
        source_collaborators: target.sourceCollaborators ?? null,
        source_daily_staff: target.sourceDailyStaff ?? null,
        source_rule_type: target.businessType === "existing" ? "existing" : "new",
        survey_method: candidate.surveyMethod,
        reasons: candidate.reasons,
        warnings: result.warnings,
        route_evidence: snapshot.routeEvidence.filter((item) => item.leftTargetId === target.id || item.rightTargetId === target.id),
        before_snapshot: target.existingPlan ?? {},
      };
    });
    const assignments = applicable.flatMap((result) => result.publicSampleAssignments.map((assignment) => ({
      target_id: assignment.targetId,
      measurement_date: assignment.measurementDate,
      assignee_user_id: assignment.assigneeUserId,
      survey_code: assignment.surveyCode,
      public_sample_code: assignment.publicSampleCode,
    })));
    const plannerRunId = crypto.randomUUID();
    const { data, error } = await supabase.rpc("apply_preliminary_survey_v2_reverse_planner", {
      p_planner_run_id: plannerRunId,
      p_source_fingerprint: output.sourceFingerprint,
      p_canonical_sha: output.canonicalSha,
      p_planner_version: output.plannerVersion,
      p_plans: plans,
      p_assignments: assignments,
      p_actor_user_id: session.userId,
      p_override_reason: null,
    });
    if (error) throw error;
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return responseError(error);
  }
}
