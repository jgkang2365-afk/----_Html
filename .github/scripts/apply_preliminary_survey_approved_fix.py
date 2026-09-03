from pathlib import Path
import subprocess


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}: {old[:180]!r}")
    file_path.write_text(text.replace(old, new, 1), encoding="utf-8")


canonical_blob = subprocess.check_output(
    ["git", "hash-object", "docs/business-rules/preliminary-survey.md"], text=True
).strip()

types_path = "lib/preliminary-survey-v2/reverse-planner/types.ts"
replace_once(
    types_path,
    'export const REVERSE_PLANNER_VERSION = "fixed-assignee-reverse-planner-v1.3.1";\n'
    'export const PRELIMINARY_SURVEY_CANONICAL_SHA = "071df2c29edb789488d36094b03ed3c7114ac5ff";',
    'export const REVERSE_PLANNER_VERSION = "fixed-assignee-reverse-planner-v1.3.2";\n'
    f'export const PRELIMINARY_SURVEY_CANONICAL_SHA = "{canonical_blob}";',
)

solver_path = "lib/preliminary-survey-v2/reverse-planner/solver.ts"
replace_once(
    solver_path,
    '  const ranges = candidateDates(target.days[0]?.date ?? "", target.businessType);\n'
    '  const dates = [...ranges.primary, ...ranges.fallback];\n'
    '  return combinations.flatMap((choice) => dates.map((date) => {',
    '  const ranges = candidateDates(target.days[0]?.date ?? "", target.businessType);\n'
    '  const dates = [...ranges.primary, ...ranges.fallback];\n'
    '  const dateRank = new Map(dates.map((date, index) => [date, index] as const));\n'
    '  return combinations.flatMap((choice) => dates.map((date) => {',
)
replace_once(
    solver_path,
    '  })).filter((candidate) => validateCandidateHardRules(snapshot, target, candidate).length === 0)\n'
    '    .sort((left, right) => compareObjective(left.objective, right.objective)\n'
    '      || left.preliminaryDate.localeCompare(right.preliminaryDate)\n'
    '      || left.responsibleUserId - right.responsibleUserId\n'
    '      || (left.reviewerUserId ?? 0) - (right.reviewerUserId ?? 0));',
    '  })).filter((candidate) => validateCandidateHardRules(snapshot, target, candidate).length === 0)\n'
    '    .sort((left, right) => compareObjective(left.objective, right.objective)\n'
    '      || (dateRank.get(left.preliminaryDate) ?? Number.MAX_SAFE_INTEGER)\n'
    '        - (dateRank.get(right.preliminaryDate) ?? Number.MAX_SAFE_INTEGER)\n'
    '      || left.responsibleUserId - right.responsibleUserId\n'
    '      || (left.reviewerUserId ?? 0) - (right.reviewerUserId ?? 0));',
)
replace_once(
    solver_path,
    'export function planPreliminarySurveyGivenFixedAssignments(\n'
    '  snapshot: PlanningSnapshot,\n'
    '  options: { allowMissingRouteEvidence?: boolean; deadlineAt?: number } = {},\n'
    '): ReversePlannerOutput {',
    'export function planPreliminarySurveyGivenFixedAssignments(\n'
    '  snapshot: PlanningSnapshot,\n'
    '  options: {\n'
    '    allowMissingRouteEvidence?: boolean;\n'
    '    deadlineAt?: number;\n'
    '    forcedCandidates?: Map<number, PlannerCandidate>;\n'
    '  } = {},\n'
    '): ReversePlannerOutput {',
)
replace_once(
    solver_path,
    '    } else if (measurementRouteEvidenceMissing(snapshot, target, options.allowMissingRouteEvidence)) routeBlocked.add(target.id);\n'
    '    else {\n'
    '      const keep = existingCandidate(snapshot, target);\n'
    '      choices.set(target.id, [...(keep ? [keep] : []), ...candidatesFor(snapshot, target)]);\n'
    '    }',
    '    } else if (measurementRouteEvidenceMissing(snapshot, target, options.allowMissingRouteEvidence)) routeBlocked.add(target.id);\n'
    '    else {\n'
    '      const forced = options.forcedCandidates?.get(target.id);\n'
    '      if (forced) {\n'
    '        choices.set(target.id, validateCandidateHardRules(snapshot, target, forced).length === 0 ? [forced] : []);\n'
    '      } else {\n'
    '        const keep = existingCandidate(snapshot, target);\n'
    '        choices.set(target.id, [...(keep ? [keep] : []), ...candidatesFor(snapshot, target)]);\n'
    '      }\n'
    '    }',
)

route_path = "app/api/preliminary-survey-v2/reverse-planner/route.ts"
replace_once(
    route_path,
    'import { planPreliminarySurveyGivenFixedAssignments, validateCandidateForSave } from "@/lib/preliminary-survey-v2/reverse-planner/solver";',
    'import { planPreliminarySurveyGivenFixedAssignments, validateCandidateForSave, validateCandidateHardRules } from "@/lib/preliminary-survey-v2/reverse-planner/solver";',
)
replace_once(
    route_path,
    '''function assignmentOrigin(target: PlanningSnapshot["targets"][number], measurementDate: string) {
  return target.fixedAssignments.find((fixed) => fixed.measurementDate === measurementDate)?.origin === "automatic"
    ? "automatic" as const : "confirmed" as const;
}

async function authorize() {''',
    '''function assignmentOrigin(target: PlanningSnapshot["targets"][number], measurementDate: string) {
  return target.fixedAssignments.find((fixed) => fixed.measurementDate === measurementDate)?.origin === "automatic"
    ? "automatic" as const : "confirmed" as const;
}

type ReviewAdjustmentPayload = {
  targetId: number;
  preliminaryDate: string;
  participantUserIds: number[];
};

function sameReviewCandidate(left: PlannerCandidate | null, right: PlannerCandidate) {
  return Boolean(left
    && left.preliminaryDate === right.preliminaryDate
    && left.surveyMethod === right.surveyMethod
    && left.responsibleUserId === right.responsibleUserId
    && left.reviewerUserId === right.reviewerUserId
    && JSON.stringify([...left.participantUserIds].sort((a, b) => a - b))
      === JSON.stringify([...right.participantUserIds].sort((a, b) => a - b)));
}

function parseReviewAdjustments(snapshot: PlanningSnapshot, value: unknown) {
  const candidates = new Map<number, PlannerCandidate>();
  const violations = new Map<number, string[]>();
  if (value == null) return { candidates, violations };
  if (!Array.isArray(value)) {
    violations.set(-1, ["INVALID_REVIEW_ADJUSTMENT_PAYLOAD"]);
    return { candidates, violations };
  }
  const seen = new Set<number>();
  for (const raw of value as Array<Partial<ReviewAdjustmentPayload>>) {
    const targetId = Number(raw?.targetId);
    const preliminaryDate = String(raw?.preliminaryDate ?? "");
    const participantUserIds = Array.isArray(raw?.participantUserIds)
      ? [...new Set(raw.participantUserIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
      : [];
    const target = snapshot.targets.find((item) => item.id === targetId);
    const localViolations: string[] = [];
    if (!Number.isInteger(targetId) || seen.has(targetId) || !target || !DATE_ONLY.test(preliminaryDate)) {
      localViolations.push("INVALID_REVIEW_ADJUSTMENT_PAYLOAD");
    }
    seen.add(targetId);
    if (!target) {
      violations.set(targetId || -1, localViolations);
      continue;
    }
    const participantUsers = participantUserIds.map((id) => snapshot.users.find((user) => user.id === id));
    if (!participantUserIds.length || participantUsers.some((user) => !user?.active)) localViolations.push("USER_NOT_FOUND");
    const validUsers = participantUsers.filter((user): user is NonNullable<typeof user> => Boolean(user?.active));
    const experienced = validUsers.filter((user) => user.experienced);
    const novices = validUsers.filter((user) => !user.experienced);
    let responsibleUserId: number | null = null;
    let reviewerUserId: number | null = null;
    let writerUserId: number | null = null;
    if (validUsers.length === 1 && experienced.length === 1) {
      responsibleUserId = experienced[0].id;
      writerUserId = experienced[0].id;
    } else if (validUsers.length === 2 && experienced.length === 1 && novices.length === 1) {
      responsibleUserId = novices[0].id;
      reviewerUserId = experienced[0].id;
      writerUserId = novices[0].id;
    } else {
      localViolations.push("INVALID_SURVEYOR_ROLE_COMBINATION");
    }
    if (target.fixedAssignments.length !== target.days.length) localViolations.push("FIXED_ASSIGNEE_NOT_CONFIRMED");
    if (target.protected) localViolations.push("PROTECTED_PLAN_REQUIRES_REVIEW");
    if (target.days.some((day) => day.date.startsWith("2026-08-"))) localViolations.push("TRANSITION_BOUNDARY_REVIEW_REQUIRED");
    if (responsibleUserId != null && writerUserId != null) {
      const candidate: PlannerCandidate = {
        preliminaryDate,
        surveyMethod: target.businessType === "existing" ? "phone" : "field",
        participantUserIds,
        responsibleUserId,
        reviewerUserId,
        writerUserId,
        objective: [0, 0, 0, 0, 0, 0] as const,
        reasons: ["USER_REVIEW_ADJUSTMENT"],
      };
      localViolations.push(...validateCandidateHardRules(snapshot, target, candidate));
      if (!localViolations.length) candidates.set(targetId, candidate);
    }
    if (localViolations.length) violations.set(targetId, [...new Set(localViolations)].sort());
  }
  return { candidates, violations };
}

function reviewAdjustmentConflictTargets(
  output: ReturnType<typeof planPreliminarySurveyGivenFixedAssignments>,
  forced: Map<number, PlannerCandidate>,
) {
  return [...forced.entries()].flatMap(([targetId, candidate]) => {
    const result = output.results.find((item) => item.targetId === targetId);
    return result?.decision === "AUTO_ASSIGNED" && sameReviewCandidate(result.candidate, candidate) ? [] : [targetId];
  });
}

async function authorize() {''',
)
replace_once(
    route_path,
    '''    if (body.action !== "apply" && body.action !== "override") {
      return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
    }''',
    '''    if (body.action !== "apply" && body.action !== "override" && body.action !== "validate_adjustment") {
      return NextResponse.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
    }''',
)
replace_once(
    route_path,
    '''    const frozenSnapshot = { ...snapshot, routeEvidence: preview.routeEvidence };
    const output = planPreliminarySurveyGivenFixedAssignments(frozenSnapshot);
    if (preview.sourceFingerprint !== output.sourceFingerprint) throw new Error("SOURCE_CHANGED");
    if (body.action === "override") {''',
    '''    const frozenSnapshot = { ...snapshot, routeEvidence: preview.routeEvidence };
    let output = planPreliminarySurveyGivenFixedAssignments(frozenSnapshot);
    if (preview.sourceFingerprint !== output.sourceFingerprint) throw new Error("SOURCE_CHANGED");

    if (body.action === "validate_adjustment") {
      const parsed = parseReviewAdjustments(frozenSnapshot, body.reviewAdjustments);
      if (parsed.violations.size) {
        return NextResponse.json({
          success: true,
          valid: false,
          violations: Object.fromEntries(parsed.violations),
          conflictTargetIds: [...parsed.violations.keys()].filter((id) => id > 0),
        });
      }
      const adjustedOutput = planPreliminarySurveyGivenFixedAssignments(frozenSnapshot, {
        forcedCandidates: parsed.candidates,
      });
      const conflictTargetIds = reviewAdjustmentConflictTargets(adjustedOutput, parsed.candidates);
      if (conflictTargetIds.length) {
        return NextResponse.json({
          success: true,
          valid: false,
          violations: Object.fromEntries(conflictTargetIds.map((id) => [id, ["REVIEW_ADJUSTMENT_BATCH_CONFLICT"]])),
          conflictTargetIds,
        });
      }
      return NextResponse.json({
        success: true,
        valid: true,
        results: adjustedOutput.results,
        sourceFingerprint: adjustedOutput.sourceFingerprint,
        routeEvidence: preview.routeEvidence,
      });
    }

    if (body.action === "override") {''',
)
replace_once(
    route_path,
    '''    if (String(body.sourceFingerprint ?? "") !== output.sourceFingerprint) {
      return NextResponse.json({ error: "원천이 변경되어 적용하지 않았습니다.", code: "SOURCE_CHANGED", appliedCount: 0 }, { status: 409 });
    }
    const applicable = output.results.filter((result) => result.decision === "AUTO_ASSIGNED"''',
    '''    if (String(body.sourceFingerprint ?? "") !== output.sourceFingerprint) {
      return NextResponse.json({ error: "원천이 변경되어 적용하지 않았습니다.", code: "SOURCE_CHANGED", appliedCount: 0 }, { status: 409 });
    }
    const parsedReview = parseReviewAdjustments(frozenSnapshot, body.reviewAdjustments);
    if (parsedReview.violations.size) {
      return NextResponse.json({
        error: "수정안이 현재 운영지침을 통과하지 못했습니다. 다시 검토해 주세요.",
        code: "REVIEW_ADJUSTMENT_REQUIRES_OVERRIDE",
        violations: Object.fromEntries(parsedReview.violations),
        appliedCount: 0,
      }, { status: 409 });
    }
    if (parsedReview.candidates.size) {
      const adjustedOutput = planPreliminarySurveyGivenFixedAssignments(frozenSnapshot, {
        forcedCandidates: parsedReview.candidates,
      });
      const conflictTargetIds = reviewAdjustmentConflictTargets(adjustedOutput, parsedReview.candidates);
      if (conflictTargetIds.length) {
        return NextResponse.json({
          error: "수정안과 같은 batch의 다른 배정안 사이에 일정·용량·동선 충돌이 있습니다.",
          code: "REVIEW_ADJUSTMENT_BATCH_CONFLICT",
          targetIds: conflictTargetIds,
          appliedCount: 0,
        }, { status: 409 });
      }
      output = adjustedOutput;
    }
    const reviewAdjustedTargetIds = new Set(parsedReview.candidates.keys());
    const applicable = output.results.filter((result) => result.decision === "AUTO_ASSIGNED"''',
)
replace_once(
    route_path,
    '''        reasons: candidate.reasons,
        warnings: result.warnings,''',
    '''        reasons: reviewAdjustedTargetIds.has(target.id)
          ? [...new Set([...candidate.reasons, "USER_REVIEW_ADJUSTMENT"])]
          : candidate.reasons,
        warnings: result.warnings,''',
)
replace_once(
    route_path,
    '''      p_assignments: assignments,
      p_actor_user_id: session.userId,
      p_override_reason: null,
    });
    if (error) throw error;
    return NextResponse.json({ success: true, ...data });
  } catch (error) {''',
    '''      p_assignments: assignments,
      p_actor_user_id: session.userId,
      p_override_reason: null,
    });
    if (error) throw error;
    return NextResponse.json({ success: true, ...data, reviewAdjustedCount: reviewAdjustedTargetIds.size });
  } catch (error) {''',
)

ui_path = "components/features/FixedAssigneeReversePlanner.tsx"
replace_once(
    ui_path,
    '''interface FixedAssigneeReversePlannerProps {
  isOpen: boolean;
  initialMeasurementDate: string;
  onClose: () => void;
  onApplied: () => void | Promise<void>;
}
''',
    '''interface FixedAssigneeReversePlannerProps {
  isOpen: boolean;
  initialMeasurementDate: string;
  onClose: () => void;
  onApplied: () => void | Promise<void>;
}

interface ReviewAdjustment {
  targetId: number;
  preliminaryDate: string;
  participantUserIds: number[];
}
''',
)
replace_once(
    ui_path,
    '  REVIEW_ADJUSTMENT_BATCH_CONFLICT: "같은 batch의 다른 배정안과 일정·용량·동선이 충돌합니다.",\n',
    '  REVIEW_ADJUSTMENT_BATCH_CONFLICT: "같은 batch의 다른 배정안과 일정·용량·동선이 충돌합니다.",\n'
    '  INVALID_REVIEW_ADJUSTMENT_PAYLOAD: "수정안 입력값을 확인해 주세요.",\n'
    '  USER_NOT_FOUND: "선택한 예비조사자 원천정보를 확인해 주세요.",\n',
) if 'REVIEW_ADJUSTMENT_BATCH_CONFLICT:' in Path(ui_path).read_text(encoding='utf-8') else None

# Add labels after existing violation map spread anchor when the new labels do not exist yet.
if 'INVALID_REVIEW_ADJUSTMENT_PAYLOAD:' not in Path(ui_path).read_text(encoding='utf-8'):
    replace_once(
        ui_path,
        '  MEASUREMENT_ASSIGNEE_INTERSECTION_REQUIRED: "측정자(공시료 담당자)가 예비조사자에 포함되어야 합니다.",\n};',
        '  MEASUREMENT_ASSIGNEE_INTERSECTION_REQUIRED: "측정자(공시료 담당자)가 예비조사자에 포함되어야 합니다.",\n'
        '  REVIEW_ADJUSTMENT_BATCH_CONFLICT: "같은 batch의 다른 배정안과 일정·용량·동선이 충돌합니다.",\n'
        '  INVALID_REVIEW_ADJUSTMENT_PAYLOAD: "수정안 입력값을 확인해 주세요.",\n'
        '  USER_NOT_FOUND: "선택한 예비조사자 원천정보를 확인해 주세요.",\n};',
    )
replace_once(
    ui_path,
    '  const [overrideViolations, setOverrideViolations] = useState<string[]>([]);',
    '  const [overrideViolations, setOverrideViolations] = useState<string[]>([]);\n'
    '  const [reviewAdjustments, setReviewAdjustments] = useState<Map<number, ReviewAdjustment>>(new Map());',
)
replace_once(
    ui_path,
    '''    setSnapshot(result.snapshot);
      setCanOverride(result.canOverride === true);''',
    '''    setSnapshot(result.snapshot);
      setReviewAdjustments(new Map());
      setCanOverride(result.canOverride === true);''',
)
replace_once(
    ui_path,
    '''      setPreview(result);
      const protectedTargetIds =''',
    '''      setPreview(result);
      setReviewAdjustments(new Map());
      const protectedTargetIds =''',
)
replace_once(
    ui_path,
    '''          action: "apply", measurementDate, sourceFingerprint: preview.sourceFingerprint,
          previewToken: preview.previewToken,''',
    '''          action: "apply", measurementDate, sourceFingerprint: preview.sourceFingerprint,
          previewToken: preview.previewToken, reviewAdjustments: [...reviewAdjustments.values()],''',
)
replace_once(
    ui_path,
    '''      setPreview(null);
      setRepairDrafts([]);
      const appliedCount = Number(result.appliedCount ?? 0);''',
    '''      setPreview(null);
      setRepairDrafts([]);
      setReviewAdjustments(new Map());
      const appliedCount = Number(result.appliedCount ?? 0);''',
)
replace_once(
    ui_path,
    '''  const openOverride = (targetId: number) => {
    const target = snapshot?.targets.find((item) => item.id === targetId);
    const team = [...new Set(target?.days.flatMap((day) => [
      ...day.collaboratorUserIds,
      ...target.fixedAssignments.filter((fixed) => fixed.measurementDate === day.date).map((fixed) => fixed.assigneeUserId),
    ]) ?? [])];
    setOverrideTargetId(targetId);
    setOverrideDate("");
    setOverrideMethod(target?.businessType === "existing" ? "phone" : "field");
    setOverrideResponsible(team[0] ?? null);
    setOverrideReviewer(null);
    setOverrideParticipants(team[0] ? [team[0]] : []);
    setOverrideReason("");
    setOverrideViolations([]);
  };

  const saveOverride = async () => {''',
    '''  const openOverride = (targetId: number) => {
    const target = snapshot?.targets.find((item) => item.id === targetId);
    const result = preview?.results.find((item) => item.targetId === targetId);
    const repair = repairDrafts.find((item) => Number(item.targetId) === targetId) as any;
    const adjustment = reviewAdjustments.get(targetId);
    const candidate = result?.candidate;
    const plan = target?.existingPlan;
    const team = [...new Set(target?.days.flatMap((day) => [
      ...day.collaboratorUserIds,
      ...target.fixedAssignments.filter((fixed) => fixed.measurementDate === day.date).map((fixed) => fixed.assigneeUserId),
    ]) ?? [])];
    const participants = adjustment?.participantUserIds
      ?? candidate?.participantUserIds ?? plan?.participantUserIds ?? repair?.participantUserIds ?? team.slice(0, 1);
    setOverrideTargetId(targetId);
    setOverrideDate(adjustment?.preliminaryDate ?? candidate?.preliminaryDate ?? plan?.preliminaryDate ?? repair?.recommendedDate ?? "");
    setOverrideMethod(candidate?.surveyMethod ?? plan?.surveyMethod ?? repair?.surveyMethod
      ?? (target?.businessType === "existing" ? "phone" : "field"));
    setOverrideResponsible(candidate?.responsibleUserId ?? plan?.responsibleUserId ?? repair?.responsibleUserId ?? team[0] ?? null);
    setOverrideReviewer(candidate?.reviewerUserId ?? plan?.reviewerUserId ?? repair?.experiencedReviewerUserId ?? null);
    setOverrideParticipants(participants);
    setOverrideReason("");
    setOverrideViolations([]);
    setError(null);
  };

  const stageAdjustment = async () => {
    if (!preview || overrideTargetId == null) return;
    const adjustment: ReviewAdjustment = {
      targetId: overrideTargetId,
      preliminaryDate: overrideDate,
      participantUserIds: [...new Set(overrideParticipants)].sort((a, b) => a - b),
    };
    const next = new Map(reviewAdjustments);
    next.set(overrideTargetId, adjustment);
    setWorking(true);
    setError(null);
    setOverrideViolations([]);
    try {
      const response = await fetch("/api/preliminary-survey-v2/reverse-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "validate_adjustment",
          measurementDate,
          previewToken: preview.previewToken,
          reviewAdjustments: [...next.values()],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "수정안 검증에 실패했습니다.");
      if (!result.valid) {
        const targetViolations = result.violations?.[String(overrideTargetId)]
          ?? result.violations?.[overrideTargetId] ?? ["REVIEW_ADJUSTMENT_BATCH_CONFLICT"];
        setOverrideViolations(targetViolations);
        setError("수정안이 자동배정 지침을 통과하지 못했습니다. 값을 조정하거나 관리자 예외 처리를 검토해 주세요.");
        return;
      }
      setReviewAdjustments(next);
      setPreview((current) => current ? { ...current, results: result.results ?? current.results } : current);
      setOverrideTargetId(null);
      setNotice("수정안을 Preview에 반영했습니다. 배정 확정 전에는 저장되지 않습니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "수정안 검증에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  };

  const saveOverride = async () => {''',
)
replace_once(
    ui_path,
    '''  const canApply = Boolean(preview?.results.some((result) => result.decision === "AUTO_ASSIGNED"
    && (result.mutation === "CREATE" || result.mutation === "REPLACE")) || repairableCount > 0);''',
    '''  const canApply = Boolean(preview?.results.some((result) => result.decision === "AUTO_ASSIGNED"
    && (result.mutation === "CREATE" || result.mutation === "REPLACE")) || repairableCount > 0 || reviewAdjustments.size > 0);
  const snapshotTargetCount = snapshot?.targets.length ?? 0;''',
)
replace_once(
    ui_path,
    '      <div className="max-h-[55vh] overflow-auto rounded-lg border border-surface-200 bg-white">\n'
    '        <table className="w-full min-w-[1180px] table-fixed text-left text-sm">',
    '      <div data-testid="preliminary-survey-auto-assignment-table-scroll"\n'
    '        data-vertical-scroll={snapshotTargetCount > 8 ? "enabled" : "disabled"}\n'
    '        className={`${snapshotTargetCount > 8 ? "max-h-[55vh] overflow-auto" : "overflow-x-auto"} rounded-lg border border-surface-200 bg-white`}>\n'
    '        <table className="w-full min-w-[1180px] table-fixed text-left text-sm">',
)
replace_once(
    ui_path,
    '''              const routeLabels = [...new Set((preview?.routeEvidence ?? [])
                .filter((item) => item.leftTargetId === target.id || item.rightTargetId === target.id)
                .map((item) => item.sameAddress ? "동일주소"
                  : item.durationMinutes == null ? "이동경로 확인 필요"
                    : item.durationMinutes <= 30 ? `차량 ${item.durationMinutes}분`
                      : `차량 ${item.durationMinutes}분 · 추가 검토`))];''',
    '''              const routeWarnings = (preview?.routeEvidence ?? [])
                .filter((item) => (item.leftTargetId === target.id || item.rightTargetId === target.id)
                  && !item.sameAddress && (item.durationMinutes == null || item.durationMinutes > 30))
                .map((item) => {
                  const otherId = item.leftTargetId === target.id ? item.rightTargetId : item.leftTargetId;
                  const otherTarget = snapshot?.targets.find((entry) => entry.id === otherId);
                  const otherOccupancy = [...(snapshot?.actualMeasurementOccupancy ?? []), ...(snapshot?.existingSurveyOccupancy ?? [])]
                    .find((entry) => entry.targetId === otherId);
                  const otherLabel = otherTarget ? `${otherTarget.code} ${otherTarget.name}`
                    : otherOccupancy?.businessCode ?? `대상 ${otherId}`;
                  const sharedNames = (item.sharedUserIds ?? []).map((id) => userById.get(id)?.name).filter(Boolean).join(" · ");
                  const label = item.durationMinutes == null ? "이동경로 확인 필요"
                    : item.durationMinutes <= 60 ? `동선 검토 ${item.durationMinutes}분`
                      : `동선 불가 ${item.durationMinutes}분`;
                  const detail = `${item.date} · ${otherLabel}${sharedNames ? ` · 공통 ${sharedNames}` : ""}`
                    + ` · 정방향 ${item.forwardDurationMinutes ?? "-"}분 · 역방향 ${item.reverseDurationMinutes ?? "-"}분`
                    + ` · 적용 ${item.effectiveDurationMinutes ?? item.durationMinutes ?? "-"}분`;
                  return { label, detail };
                });''',
)
replace_once(
    ui_path,
    '              return <tr key={target.id} className={result && result.decision !== "AUTO_ASSIGNED" ? "bg-amber-50/40 align-top" : "align-top"}>',
    '              const isReviewAdjusted = reviewAdjustments.has(target.id);\n'
    '              return <tr key={target.id} className={result && result.decision !== "AUTO_ASSIGNED" ? "bg-amber-50/40 align-top" : "align-top"}>',
)
replace_once(
    ui_path,
    '<td className="px-3 py-3"><div className="font-semibold text-text-900">{target.code}</div><div className="truncate text-text-700" title={target.name}>{target.name}</div></td>\n'
    '                <td className="px-3 py-3 text-text-700">{target.days.map((day) => <div key={day.date}>{day.date}</div>)}</td>\n'
    '                <td className="space-y-2 px-3 py-3">',
    '<td className="px-2 py-2"><div className="font-semibold text-text-900">{target.code}</div><div className="truncate text-text-700" title={target.name}>{target.name}</div></td>\n'
    '                <td className="px-2 py-2 text-text-700">{target.days.map((day) => <div key={day.date}>{day.date}</div>)}</td>\n'
    '                <td className="space-y-1 px-2 py-2">',
)
replace_once(
    ui_path,
    '''                <td className="px-3 py-3 text-text-700">{target.days.map((day) => <div key={day.date}>{day.collaboratorUserIds.map((id) => userById.get(id)?.name).filter(Boolean).join(" · ") || "-"}</div>)}</td>
                <td className="px-3 py-3 text-text-700">{target.days.map((day) => <div key={day.date}>{day.reportWriterUserId == null ? "-" : userById.get(day.reportWriterUserId)?.name ?? "-"}</div>)}</td>
                <td className="bg-primary-50/50 px-3 py-3 text-base font-bold text-primary-900">{preliminaryDate ?? "-"}</td>
                <td className="bg-primary-50/50 px-3 py-3 text-base font-bold text-primary-900">{participantText(surveyorIds)}</td>
                <td className="px-3 py-3 font-medium">{method === "field" ? "방문" : method === "phone" ? "유선" : "-"}</td>
                <td className="px-3 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${status.tone}`}>{status.label}</span>
                  {routeLabels.length > 0 && <div className="mt-2 text-xs text-text-600">{routeLabels.join(" · ")}</div>}
                  {canOverride && result?.decision === "MANUAL_REQUIRED" && <button type="button" className="mt-2 text-xs font-medium text-primary-700 underline" onClick={() => openOverride(target.id)}>예외 처리</button>}
                </td>''',
    '''                <td className="px-2 py-2 text-text-700">{target.days.map((day) => <div key={day.date}>{day.collaboratorUserIds.map((id) => userById.get(id)?.name).filter(Boolean).join(" · ") || "-"}</div>)}</td>
                <td className="px-2 py-2 text-text-700">{target.days.map((day) => <div key={day.date}>{day.reportWriterUserId == null ? "-" : userById.get(day.reportWriterUserId)?.name ?? "-"}</div>)}</td>
                <td className="bg-primary-50/50 px-2 py-2 text-base font-bold text-primary-900">{preliminaryDate ?? "-"}</td>
                <td className="bg-primary-50/50 px-2 py-2 text-base font-bold text-primary-900">{participantText(surveyorIds)}</td>
                <td className="px-2 py-2 font-medium">{method === "field" ? "방문" : method === "phone" ? "유선" : "-"}</td>
                <td className="px-2 py-2"><div className="flex flex-wrap items-center gap-2"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${isReviewAdjusted ? "bg-blue-50 text-blue-800" : status.tone}`}>{isReviewAdjusted ? "수정안" : status.label}</span>
                  {preview && result?.decision !== "SOURCE_INVALID" && !target.protected && <button type="button" className="text-xs font-medium text-primary-700 underline" onClick={() => openOverride(target.id)}>수정</button>}</div>
                  {routeWarnings.length > 0 && <div className="mt-1 space-y-0.5 text-xs font-medium text-amber-700">{routeWarnings.map((warning, index) => <div key={`${warning.label}-${index}`} title={warning.detail}>{warning.label}</div>)}</div>}
                </td>''',
)
replace_once(
    ui_path,
    '''      {overrideTargetId != null && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold text-amber-900">예외 처리</h3><button type="button" className="text-sm text-text-600" onClick={() => setOverrideTargetId(null)}>닫기</button></div>
        {overrideViolations.length > 0 && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><div className="font-medium">확인할 위반사항</div><ul className="mt-1 list-disc pl-5">{overrideViolations.map((violation) => <li key={violation}>{violationText(violation)}</li>)}</ul></div>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="text-sm">예비조사일<input type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2" /></label>
          <label className="text-sm">방식<select value={overrideMethod} onChange={(event) => setOverrideMethod(event.target.value as "field" | "phone")} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="field">방문</option><option value="phone">유선</option></select></label>
          <label className="text-sm">작성자<select value={overrideResponsible ?? ""} onChange={(event) => { const id = Number(event.target.value); setOverrideResponsible(id); setOverrideParticipants((current) => [...new Set([...current, id])]); }} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="">선택</option>{snapshot?.users.filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          <label className="text-sm">검토자<select value={overrideReviewer ?? ""} onChange={(event) => { const id = event.target.value ? Number(event.target.value) : null; setOverrideReviewer(id); if (id) setOverrideParticipants((current) => [...new Set([...current, id])]); }} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="">없음</option>{snapshot?.users.filter((user) => user.active && user.experienced).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
        </div>
        <fieldset className="mt-3"><legend className="text-sm font-medium">예비조사자</legend><div className="mt-2 flex flex-wrap gap-3">{snapshot?.users.filter((user) => user.active).map((user) => <label key={user.id} className="text-sm"><input type="checkbox" checked={overrideParticipants.includes(user.id)} onChange={(event) => setOverrideParticipants((current) => event.target.checked ? [...new Set([...current, user.id])] : current.filter((id) => id !== user.id))} /> {user.name}</label>)}</div></fieldset>
        <label className="mt-3 block text-sm">예외 사유<textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} className="mt-1 min-h-20 w-full rounded border border-surface-300 bg-white p-2" placeholder="구체적인 업무상 예외 사유" /></label>
        <div className="mt-3 flex justify-end"><Button size="sm" onClick={saveOverride} disabled={working || !overrideDate || !overrideResponsible || !overrideParticipants.length || !overrideReason.trim()}>{overrideViolations.length > 0 ? "위반 확인 후 저장" : "위반 검증"}</Button></div>
      </div>}''',
    '''      {overrideTargetId != null && <div className="rounded-lg border border-primary-200 bg-primary-50/30 p-4">
        <div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-text-900">배정안 수정</h3><p className="mt-1 text-xs text-text-600">정상 수정안은 Preview에만 반영되며 배정 확정 전에는 저장되지 않습니다.</p></div><button type="button" className="text-sm text-text-600" onClick={() => setOverrideTargetId(null)}>닫기</button></div>
        {overrideViolations.length > 0 && <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><div className="font-medium">확인할 위반사항</div><ul className="mt-1 list-disc pl-5">{overrideViolations.map((violation) => <li key={violation}>{violationText(violation)}</li>)}</ul></div>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-sm">예비조사일<input type="date" value={overrideDate} onChange={(event) => { setOverrideDate(event.target.value); setOverrideViolations([]); }} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2" /></label>
          <div className="text-sm">방식<div className="mt-1 flex h-9 items-center rounded border border-surface-200 bg-surface-50 px-2 font-medium">{overrideMethod === "field" ? "방문" : "유선"} · 업체 구분 기준 고정</div></div>
        </div>
        <fieldset className="mt-3"><legend className="text-sm font-medium">예비조사자</legend><div className="mt-2 flex flex-wrap gap-3">{snapshot?.users.filter((user) => user.active).map((user) => <label key={user.id} className="text-sm"><input type="checkbox" checked={overrideParticipants.includes(user.id)} onChange={(event) => { setOverrideViolations([]); setOverrideParticipants((current) => event.target.checked ? [...new Set([...current, user.id])] : current.filter((id) => id !== user.id)); }} /> {user.name}</label>)}</div></fieldset>
        <div className="mt-3 flex justify-end"><Button size="sm" onClick={stageAdjustment} disabled={working || !overrideDate || !overrideParticipants.length}>수정안 검증</Button></div>
        {canOverride && overrideViolations.length > 0 && <div className="mt-4 border-t border-amber-300 pt-4">
          <div className="mb-2 text-sm font-semibold text-amber-900">관리자 예외 처리</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="text-sm">방식<select value={overrideMethod} onChange={(event) => setOverrideMethod(event.target.value as "field" | "phone")} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="field">방문</option><option value="phone">유선</option></select></label>
            <label className="text-sm">작성자<select value={overrideResponsible ?? ""} onChange={(event) => { const id = Number(event.target.value); setOverrideResponsible(id); setOverrideParticipants((current) => [...new Set([...current, id])]); }} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="">선택</option>{snapshot?.users.filter((user) => user.active).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
            <label className="text-sm">검토자<select value={overrideReviewer ?? ""} onChange={(event) => { const id = event.target.value ? Number(event.target.value) : null; setOverrideReviewer(id); if (id) setOverrideParticipants((current) => [...new Set([...current, id])]); }} className="mt-1 block h-9 w-full rounded border border-surface-300 bg-white px-2"><option value="">없음</option>{snapshot?.users.filter((user) => user.active && user.experienced).map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
          </div>
          <label className="mt-3 block text-sm">예외 사유<textarea value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} className="mt-1 min-h-20 w-full rounded border border-surface-300 bg-white p-2" placeholder="구체적인 업무상 예외 사유" /></label>
          <div className="mt-3 flex justify-end"><Button size="sm" variant="danger" onClick={saveOverride} disabled={working || !overrideDate || !overrideResponsible || !overrideParticipants.length || !overrideReason.trim()}>관리자 예외로 즉시 저장</Button></div>
        </div>}
      </div>}''',
)

test_path = "tests/preliminary-survey-reverse-planner.test.ts"
test_file = Path(test_path)
test_text = test_file.read_text(encoding="utf-8")
marker = '\ntest("v1.1 정상 Apply만 재활성화하고 legacy manual write는 계속 차단한다", () => {'
if marker not in test_text:
    raise SystemExit("test insertion marker missing")
addition = r'''

test("H0527 최초실시는 -3 → -20 후보순위를 보존해 2026-08-28을 먼저 선택한다", () => {
  const h0527 = target({
    businessType: "first_measurement",
    days: [{ date: "2026-09-02", collaboratorUserIds: [5], reportWriterUserId: 5 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-02", assigneeUserId: 5, confirmedAt: "x", updatedAt: "x" }],
  });
  const input = fixture({ targets: [h0527] });
  assert.equal(candidateDates("2026-09-02", "first_measurement").primary[0], "2026-08-28");
  const result = resultFor(input);
  assert.equal(result.decision, "AUTO_ASSIGNED");
  assert.equal(result.candidate?.preliminaryDate, "2026-08-28");
});

test("사용자 검토 수정안은 forced candidate로 batch 재계산되어 선택값을 보존한다", () => {
  const h0527 = target({
    businessType: "first_measurement",
    days: [{ date: "2026-09-02", collaboratorUserIds: [5], reportWriterUserId: 5 }],
    fixedAssignments: [{ targetId: 10, measurementDate: "2026-09-02", assigneeUserId: 5, confirmedAt: "x", updatedAt: "x" }],
  });
  const input = fixture({ targets: [h0527] });
  const base = resultFor(input).candidate!;
  const forced = { ...base, preliminaryDate: candidateDates("2026-09-02", "first_measurement").primary[1],
    objective: [0, 0, 0, 0, 0, 0] as const, reasons: ["USER_REVIEW_ADJUSTMENT"] };
  const output = planPreliminarySurveyGivenFixedAssignments(input, { forcedCandidates: new Map([[10, forced]]) });
  assert.equal(output.results[0].decision, "AUTO_ASSIGNED");
  assert.equal(output.results[0].candidate?.preliminaryDate, forced.preliminaryDate);
});

test("자동배정 UI는 정상 30분 이하 차량값을 숨기고 8개까지 내부 세로스크롤을 끈다", () => {
  const ui = readFileSync("components/features/FixedAssigneeReversePlanner.tsx", "utf8");
  const route = readFileSync("app/api/preliminary-survey-v2/reverse-planner/route.ts", "utf8");
  assert.match(ui, /item\.durationMinutes == null \|\| item\.durationMinutes > 30/);
  assert.match(ui, /동선 검토/);
  assert.match(ui, /동선 불가/);
  assert.doesNotMatch(ui, /item\.durationMinutes <= 30 \? `차량/);
  assert.match(ui, /snapshotTargetCount > 8 \? "enabled" : "disabled"/);
  assert.match(ui, /reviewAdjustments: \[\.\.\.reviewAdjustments\.values\(\)\]/);
  assert.match(ui, /배정 확정 전에는 저장되지 않습니다/);
  assert.match(route, /body\.action !== "validate_adjustment"/);
  assert.match(route, /USER_REVIEW_ADJUSTMENT/);
  assert.match(route, /forcedCandidates: parsedReview\.candidates/);
});
'''
test_file.write_text(test_text.replace(marker, addition + marker, 1), encoding="utf-8")

print(f"patched implementation against canonical blob {canonical_blob}")
