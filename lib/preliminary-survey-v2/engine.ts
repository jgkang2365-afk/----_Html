import { holidayCoverageWarning, recommendationDates, recommendationDatesForBusinessType } from "./calendar";
import { evaluateSameDayRoute, type EvaluatedSameDayRoute } from "./route-policy";
import type {
  Availability, ExistingAssignment, RecommendationEvidence, RecommendationResult,
  RouteMetric, RouteMetrics, SameDayRouteEvidence, SurveyTarget, SurveyUser,
} from "./types";
import { surveyMethodForKind } from "./types";
import { fitsExistingPhoneResponsibleLimit } from "./responsible-capacity";

export interface RecommendBatchInput {
  targets: SurveyTarget[];
  /** 책임 예비조사자를 아직 정하지 않은 경우의 단일 planner 후보군. */
  surveyors?: SurveyUser[];
  experiencedUsers: SurveyUser[];
  existingAssignments?: ExistingAssignment[];
  availability: Availability;
  routes: RouteMetrics;
}

const SAME_ROUTE_THRESHOLD_MINUTES = 30 as const;
const HARD_MAXIMUM_MINUTES = 60 as const;

function deterministicTargets(targets: SurveyTarget[]) {
  const priority = (target: SurveyTarget) => target.businessType === "first_measurement"
    ? 0
    : target.businessType === "external_new" ? 1 : 2;
  return [...targets].sort((left, right) =>
    priority(left) - priority(right) ||
    left.measurementDate.localeCompare(right.measurementDate) ||
    (left.createdAt ?? "9999").localeCompare(right.createdAt ?? "9999") ||
    left.id - right.id,
  );
}

function targetRecommendationDates(target: SurveyTarget) {
  return target.businessType
    ? recommendationDatesForBusinessType(target.measurementDate, target.businessType)
    : recommendationDates(target.measurementDate);
}

function newFieldCount(assignments: ExistingAssignment[], userId: number, date?: string) {
  return assignments.filter((item) =>
    item.kind === "new" && item.participants.includes(userId) && (!date || item.date === date),
  ).length;
}

function assignmentSurveyMethod(assignment: ExistingAssignment) {
  return assignment.surveyMethod ?? surveyMethodForKind(assignment.kind);
}

/** 사업장 구분이 아니라 실제 방문 방식 기준으로 참여자별 현장 용량을 센다. */
function fieldVisitCount(assignments: ExistingAssignment[], userId: number, date: string) {
  return assignments.filter((item) =>
    item.date === date && assignmentSurveyMethod(item) === "field" && item.participants.includes(userId),
  ).length;
}

function existingReviewCount(assignments: ExistingAssignment[], userId: number, date: string) {
  return assignments.filter((item) =>
    item.kind === "existing" && item.date === date && item.experiencedReviewerId === userId,
  ).length;
}

function allFieldCount(assignments: ExistingAssignment[], userId: number) {
  // 기존업체 경력 검토는 의도적으로 제외한다.
  return assignments.filter((item) =>
    item.participants.includes(userId) &&
    !(item.kind === "existing" && item.experiencedReviewerId === userId),
  ).length;
}

function asAssignment(target: SurveyTarget, result: RecommendationResult): ExistingAssignment {
  return {
    targetId: target.id,
    businessCode: target.code,
    kind: target.kind,
    date: result.date!,
    participants: result.participants.map((user) => user.id),
    responsibleUserId: result.responsible.id,
    experiencedReviewerId: result.experiencedReviewer?.id ?? null,
    surveyMethod: result.surveyMethod,
    address: target.address,
    coordinate: target.coordinate,
    region: target.region,
  };
}

async function routeAgainstSameDayField(
  target: SurveyTarget,
  userId: number,
  date: string,
  assignments: ExistingAssignment[],
  routes: RouteMetrics,
): Promise<EvaluatedSameDayRoute | null> {
  const other = assignments.find((item) =>
    item.date === date && assignmentSurveyMethod(item) === "field" && item.participants.includes(userId),
  );
  if (!other) return null;

  const otherAddress = String(other.address ?? "").replace(/\s+/g, "");
  const targetAddress = String(target.address ?? "").replace(/\s+/g, "");
  if (otherAddress && otherAddress === targetAddress) {
    return {
      evidence: {
        firstBusinessCode: other.businessCode,
        secondBusinessCode: target.code,
        routeABMinutes: 0,
        routeBAMinutes: 0,
        selectedRouteMinutes: 0,
        selectedVisitOrder: [other.businessCode, target.code],
        routeDecision: "same_day_allowed",
        routeSource: "unverified",
      },
      selectedRoute: null,
    };
  }

  return evaluateSameDayRoute(other, target, routes);
}

function existingReviewTotalCount(assignments: ExistingAssignment[], userId: number) {
  return assignments.filter((item) => item.kind === "existing" && item.experiencedReviewerId === userId).length;
}

function compareRoute(left: EvaluatedSameDayRoute | null, right: EvaluatedSameDayRoute | null) {
  const rank = (route: EvaluatedSameDayRoute | null) => route?.evidence.routeDecision === "same_day_allowed" ? 0 : route ? 2 : 1;
  return rank(left) - rank(right) ||
    (left?.evidence.selectedRouteMinutes ?? Number.MAX_SAFE_INTEGER) - (right?.evidence.selectedRouteMinutes ?? Number.MAX_SAFE_INTEGER);
}

async function chooseReviewer(
  target: SurveyTarget,
  date: string,
  users: SurveyUser[],
  assignments: ExistingAssignment[],
  availability: Availability,
  routes: RouteMetrics,
  capacityPass: 1 | 2,
) {
  const choices = await Promise.all(users
    .filter((user) => user.active !== false && user.experienced && user.id !== target.responsible.id &&
      !availability.isBlocked(user.id, date))
    .map(async (user) => {
      const sameDayFieldCount = fieldVisitCount(assignments, user.id, date);
      const route = target.kind === "new" && capacityPass === 2
        ? await routeAgainstSameDayField(target, user.id, date, assignments, routes)
        : null;
      return {
        user,
        // 직원 불가 일정은 날짜별 조사자 후보에서 이미 제외한다.
        // 일일 방문량·동선만 기존 선택 경향을 위한 정렬 정보로 남긴다.
        hardConflict: false,
        route,
        // 기존업체 검토는 현장 동행·유선 수행이 아니므로 신규 방문과의 용량 중복으로 보지 않는다.
        crossTypeOverlap: false,
        newCount: newFieldCount(assignments, user.id),
        allFieldCount: allFieldCount(assignments, user.id),
        reviewCount: existingReviewCount(assignments, user.id, date),
        totalReviewCount: existingReviewTotalCount(assignments, user.id),
      };
    }));
  choices.sort((left, right) =>
    Number(left.crossTypeOverlap) - Number(right.crossTypeOverlap) ||
    compareRoute(left.route, right.route) ||
    left.reviewCount - right.reviewCount ||
    left.totalReviewCount - right.totalReviewCount ||
    left.newCount - right.newCount ||
    left.allFieldCount - right.allFieldCount ||
    left.user.id - right.user.id,
  );
  const selected = choices[0] ?? null;
  return selected ? {
    ...selected,
    crossTypeOverlapAvoided: !selected.crossTypeOverlap && choices.some((choice) => !choice.hardConflict && choice.crossTypeOverlap),
  } : null;
}

function responsibleDailyCount(assignments: ExistingAssignment[], userId: number, date: string) {
  return assignments.filter((item) => item.date === date && item.responsibleUserId === userId).length;
}

function responsibleTotalCount(assignments: ExistingAssignment[], userId: number) {
  return assignments.filter((item) => item.responsibleUserId === userId).length;
}

function responsibleRolePreference(target: SurveyTarget, userId: number) {
  const roles = target.measurementStaffByDate ?? [];
  const participantMatch = roles.some((staff) => staff.measurementParticipantUserIds.includes(userId));
  const reportWriterMatch = roles.some((staff) => staff.reportWriterUserId === userId);
  const linkageCount = roles.reduce((count, staff) => count +
    Number(staff.measurementParticipantUserIds.includes(userId)) + Number(staff.reportWriterUserId === userId), 0);
  return { participantMatch, reportWriterMatch, linkageCount };
}

function candidateRange(target: SurveyTarget, workingDaysBefore: number): "primary" | "fallback" {
  if (target.businessType === "external_new" || target.businessType === "existing") {
    return workingDaysBefore <= 20 ? "primary" : "fallback";
  }
  if (target.businessType === "first_measurement") return "primary";
  return workingDaysBefore >= 20 ? "primary" : "fallback";
}

function candidateDateGroups(
  target: SurveyTarget,
  dates: ReturnType<typeof targetRecommendationDates>,
) {
  if (target.businessType === "external_new" || target.businessType === "existing") {
    return [
      dates.filter((candidate) => candidate.workingDaysBefore <= 20),
      dates.filter((candidate) => candidate.workingDaysBefore > 20),
    ];
  }
  if (target.businessType === "first_measurement") return [dates];
  return [
    dates.filter((candidate) => candidate.workingDaysBefore >= 20),
    dates.filter((candidate) => candidate.workingDaysBefore < 20),
  ];
}

export async function recommendBatch(input: RecommendBatchInput): Promise<RecommendationResult[]> {
  const virtual = [...(input.existingAssignments ?? [])];
  const results: RecommendationResult[] = [];

  for (const target of deterministicTargets(input.targets)) {
    // service에서 별도 조사자 planner를 한 번 더 실행하지 않는다. 책임 조사자 후보와
    // 날짜를 함께 결정하고 기존 건수·경로는 동률 후보의 soft preference로만 사용한다.
    const responsibleCandidates = (input.surveyors?.length ? input.surveyors : [target.responsible])
      .filter((user) => user.active !== false)
      .sort((left, right) => left.id - right.id);
    let selected: RecommendationResult | null = null;
    const rejectedSameDayRoutes: SameDayRouteEvidence[] = [];
    const dates = targetRecommendationDates(target);

    const evaluateCandidate = async (
      planningTarget: SurveyTarget,
      candidate: (typeof dates)[number],
      capacityPass: 1 | 2,
    ) => {
      if (target.kind === "existing" && capacityPass === 2) return null;

      // 신규 방문만 비경력자 단독을 금지한다. 기존업체 유선은 책임자 기준 하루 3건까지만 허용한다.
      if (target.kind === "existing" &&
          !fitsExistingPhoneResponsibleLimit(virtual, planningTarget.responsible.id, candidate.date)) return null;
      const requiresReviewer = target.kind === "new" && !planningTarget.responsible.experienced;
      const prefersReviewer = target.kind === "existing" && !planningTarget.responsible.experienced;
      const reviewerChoice = requiresReviewer || prefersReviewer
        ? await chooseReviewer(planningTarget, candidate.date, input.experiencedUsers, virtual, input.availability, input.routes, capacityPass)
        : null;
      if (requiresReviewer && !reviewerChoice) {
        return null;
      }

      let route: RouteMetric | null = null;
      let sameDayRoute: SameDayRouteEvidence | null = null;
      if (target.kind === "new") {
        const participants = [planningTarget.responsible.id, reviewerChoice?.user.id].filter((id): id is number => Boolean(id));
        const requiresRoute = participants.some((userId) => fieldVisitCount(virtual, userId, candidate.date) > 0);
        for (const userId of participants) {
          const evaluated = reviewerChoice?.user.id === userId && reviewerChoice.route
            ? reviewerChoice.route
            : await routeAgainstSameDayField(planningTarget, userId, candidate.date, virtual, input.routes);
          if (!evaluated) continue;
          if (evaluated.evidence.routeDecision !== "same_day_allowed") {
            rejectedSameDayRoutes.push(evaluated.evidence);
            sameDayRoute = evaluated.evidence;
            route = null;
            continue;
          }
          if (!sameDayRoute || (evaluated.evidence.selectedRouteMinutes ?? 0) > (sameDayRoute.selectedRouteMinutes ?? 0)) {
            sameDayRoute = evaluated.evidence;
            route = evaluated.selectedRoute;
          }
        }
        void requiresRoute;
      }

      const reviewer = reviewerChoice && !reviewerChoice.hardConflict ? reviewerChoice.user : null;
      const reviewerMissing = prefersReviewer && !reviewer;
      const crossTypeOverlap = false;
      const evidence: RecommendationEvidence = {
        classificationSource: target.classificationSource,
        processChangedPolicyApplicable: target.processChangedPolicyApplicable === true,
        surveyMethod: surveyMethodForKind(target.kind),
        workingDaysBefore: candidate.workingDaysBefore,
        range: candidateRange(target, candidate.workingDaysBefore),
        capacityPass,
        responsibleConflict: false,
        reviewerConflict: reviewerMissing,
        route,
        sameDayRoute,
        rejectedSameDayRoutes,
        singleCandidateAvailable: capacityPass === 1,
        sameRouteMinutes: sameDayRoute?.selectedRouteMinutes ?? null,
        sameRouteThresholdMinutes: SAME_ROUTE_THRESHOLD_MINUTES,
        hardMaximumMinutes: HARD_MAXIMUM_MINUTES,
        selectionMode: capacityPass === 1 ? "single" : null,
        selectionReason: "single_available",
        experiencedNewAssignments: reviewer ? newFieldCount(virtual, reviewer.id) : null,
        experiencedAllFieldAssignments: reviewer ? allFieldCount(virtual, reviewer.id) : null,
        crossTypeOverlap,
        crossTypeOverlapAvoided: Boolean(reviewerChoice?.crossTypeOverlapAvoided),
        crossTypeOverlapReason: crossTypeOverlap ? "unavoidable_cross_type_overlap" : null,
        warnings: [
          holidayCoverageWarning(target.measurementDate),
          reviewerMissing ? "EXPERIENCED_REVIEWER_UNASSIGNED" : null,
        ].filter((value): value is string => Boolean(value)),
      };
      return {
        targetId: target.id,
        status: "recommended" as const,
        date: candidate.date,
        participants: reviewer ? [planningTarget.responsible, reviewer] : [planningTarget.responsible],
        responsible: planningTarget.responsible,
        experiencedReviewer: reviewer,
        surveyMethod: surveyMethodForKind(target.kind),
        evidence,
        reason: `${evidence.range === "primary" ? "기본구간" : "후순위구간"} -${candidate.workingDaysBefore} 워킹데이${reviewerMissing ? "; 경력 검토자 미배정" : ""}`,
      };
    };

    const evaluateForResponsible = async (candidate: (typeof dates)[number], capacityPass: 1 | 2) => {
      const feasible: RecommendationResult[] = [];
      for (const responsible of responsibleCandidates) {
        if (input.availability.isBlocked(responsible.id, candidate.date)) continue;
        const result = await evaluateCandidate({ ...target, responsible }, candidate, capacityPass);
        if (result) feasible.push(result);
      }
      feasible.sort((left, right) =>
        Number(!responsibleRolePreference(target, left.responsible.id).participantMatch) -
          Number(!responsibleRolePreference(target, right.responsible.id).participantMatch) ||
        Number(!responsibleRolePreference(target, left.responsible.id).reportWriterMatch) -
          Number(!responsibleRolePreference(target, right.responsible.id).reportWriterMatch) ||
        responsibleRolePreference(target, right.responsible.id).linkageCount -
          responsibleRolePreference(target, left.responsible.id).linkageCount ||
        responsibleDailyCount(virtual, left.responsible.id, candidate.date) -
          responsibleDailyCount(virtual, right.responsible.id, candidate.date) ||
        responsibleTotalCount(virtual, left.responsible.id) - responsibleTotalCount(virtual, right.responsible.id) ||
        left.responsible.id - right.responsible.id,
      );
      return feasible[0] ?? null;
    };

    const finalize = (
      result: RecommendationResult,
      selectionMode: NonNullable<RecommendationEvidence["selectionMode"]>,
      selectionReason: RecommendationEvidence["selectionReason"],
      singleCandidateAvailable: boolean,
      sameRouteMinutes: number | null,
    ) => {
      result.evidence.selectionMode = selectionMode;
      result.evidence.selectionReason = selectionReason;
      result.evidence.singleCandidateAvailable = singleCandidateAvailable;
      result.evidence.sameRouteMinutes = sameRouteMinutes;
      const detail = selectionReason === "same_route_preferred_under_30"
        ? `동일경로 ${sameRouteMinutes}분(30분 이하) 우선`
        : selectionReason === "single_day_preferred_over_30"
          ? `${sameRouteMinutes}분 묶음보다 신규 하루 1건 우선`
          : selectionReason === "two_job_fallback_no_single_day"
            ? `단독 가능 날짜 없음, 신규 2건 ${sameRouteMinutes}분 fallback`
            : target.kind === "new" ? "신규 하루 1건 우선" : "기존업체 배정 규칙";
      result.reason = `${result.reason}; ${detail}`;
      return result;
    };

    if (target.kind === "existing") {
      let overlapFallback: RecommendationResult | null = null;
      for (const candidate of dates) {
        const result = await evaluateForResponsible(candidate, 1);
        if (!result) continue;
        if (result.evidence.crossTypeOverlap) {
          overlapFallback ??= result;
          continue;
        }
        result.evidence.crossTypeOverlapAvoided ||= Boolean(overlapFallback);
        selected = finalize(result, "single", "single_available", true, null);
        break;
      }
      if (!selected && overlapFallback) {
        selected = finalize(overlapFallback, "single", "single_available", true, null);
      }
    } else {
      let twoJobFallback: RecommendationResult | null = null;
      for (const rangeDates of candidateDateGroups(target, dates)) {
        let single: RecommendationResult | null = null;
        let singleIndex = rangeDates.length;
        for (let index = 0; index < rangeDates.length; index += 1) {
          const result = await evaluateForResponsible(rangeDates[index], 1);
          if (!result) continue;
          single = result;
          singleIndex = index;
          break;
        }

        const pairCandidates: RecommendationResult[] = [];
        const pairDates = single ? rangeDates.slice(0, singleIndex) : rangeDates;
        for (const candidate of pairDates) {
          const result = await evaluateForResponsible(candidate, 2);
          if (result?.evidence.sameDayRoute?.routeDecision === "same_day_allowed") pairCandidates.push(result);
        }
        const sameRoute = pairCandidates.find((result) =>
          (result.evidence.sameDayRoute?.selectedRouteMinutes ?? Number.MAX_SAFE_INTEGER) <= SAME_ROUTE_THRESHOLD_MINUTES,
        ) ?? null;

        if (single) {
          if (sameRoute) {
            selected = finalize(
              sameRoute, "same_route_preferred", "same_route_preferred_under_30", true,
              sameRoute.evidence.sameDayRoute!.selectedRouteMinutes,
            );
          } else {
            const overThirty = pairCandidates[0]?.evidence.sameDayRoute?.selectedRouteMinutes ?? null;
            selected = finalize(
              single, "single", overThirty === null ? "single_available" : "single_day_preferred_over_30",
              true, overThirty,
            );
          }
        } else if (sameRoute) {
          selected = finalize(
            sameRoute, "same_route_preferred", "same_route_preferred_under_30", false,
            sameRoute.evidence.sameDayRoute!.selectedRouteMinutes,
          );
        } else if (pairCandidates[0]) {
          twoJobFallback ??= pairCandidates[0];
        }
        if (selected) break;
      }
      if (!selected && twoJobFallback) {
        selected = finalize(
          twoJobFallback, "two_job_fallback", "two_job_fallback_no_single_day", false,
          twoJobFallback.evidence.sameDayRoute!.selectedRouteMinutes,
        );
      }
    }

    if (selected) virtual.push(asAssignment(target, selected));

    const documentSurveyorMissing = dates.length > 0;
    results.push(selected ?? {
      targetId: target.id,
      status: "manual_required",
      date: null,
      participants: [],
      responsible: target.responsible,
      experiencedReviewer: null,
      surveyMethod: surveyMethodForKind(target.kind),
      evidence: {
        classificationSource: target.classificationSource,
        processChangedPolicyApplicable: target.processChangedPolicyApplicable === true,
        surveyMethod: surveyMethodForKind(target.kind),
        workingDaysBefore: null, range: null, capacityPass: null,
        responsibleConflict: true, reviewerConflict: !target.responsible.experienced,
        route: null, experiencedNewAssignments: null, experiencedAllFieldAssignments: null,
        sameDayRoute: null, rejectedSameDayRoutes,
        singleCandidateAvailable: false,
        sameRouteMinutes: null,
        sameRouteThresholdMinutes: SAME_ROUTE_THRESHOLD_MINUTES,
        hardMaximumMinutes: HARD_MAXIMUM_MINUTES,
        selectionMode: null,
        selectionReason: documentSurveyorMissing ? "document_integrity_unresolved" : "no_available_date",
        crossTypeOverlap: false,
        crossTypeOverlapAvoided: false,
        crossTypeOverlapReason: null,
        warnings: [documentSurveyorMissing ? "DOCUMENT_SURVEYOR_ASSIGNMENT_REQUIRED" : "NO_POLICY_DATE_AVAILABLE"],
      },
      reason: documentSurveyorMissing
        ? "유효한 예비조사자 또는 신규 서류에 필요한 경력 조사자를 배정할 수 없습니다."
        : "업체 유형별 영업일 범위에서 예비조사 기준일을 계산할 수 없습니다.",
    });
  }
  // 기존업체는 서류 분류 정책상 유선을 유지한다. 일정·경로는 방식을 자동 변경하지 않는다.
  return results;
}
