import { holidayCoverageWarning, recommendationDates, recommendationDatesForBusinessType } from "./calendar";
import { evaluateSameDayRoute, type EvaluatedSameDayRoute } from "./route-policy";
import type {
  Availability, ExistingAssignment, RecommendationEvidence, RecommendationResult,
  RouteMetric, RouteMetrics, SameDayRouteEvidence, SurveyTarget, SurveyUser,
} from "./types";
import { surveyMethodForKind } from "./types";

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

function existingResponsibleCount(assignments: ExistingAssignment[], userId: number, date: string) {
  return assignments.filter((item) =>
    item.kind === "existing" && item.date === date && item.responsibleUserId === userId,
  ).length;
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
    .filter((user) => user.active !== false && user.experienced && user.id !== target.responsible.id)
    .map(async (user) => {
      const sameDayFieldCount = fieldVisitCount(assignments, user.id, date);
      const sameDayNewCount = newFieldCount(assignments, user.id, date);
      const route = target.kind === "new" && capacityPass === 2
        ? await routeAgainstSameDayField(target, user.id, date, assignments, routes)
        : null;
      return {
        user,
        blocked: availability.isBlocked(user.id, date),
        hardConflict: availability.isBlocked(user.id, date) ||
          (target.kind === "existing" && existingReviewCount(assignments, user.id, date) >= 3) || (
          target.kind === "new" && (
            sameDayFieldCount >= capacityPass ||
            (sameDayFieldCount > 0 && route?.evidence.routeDecision !== "same_day_allowed")
          )
        ),
        route,
        crossTypeOverlap: target.kind === "existing"
          ? sameDayNewCount > 0
          : existingReviewCount(assignments, user.id, date) > 0,
        newCount: newFieldCount(assignments, user.id),
        allFieldCount: allFieldCount(assignments, user.id),
      };
    }));
  choices.sort((left, right) =>
    Number(left.hardConflict) - Number(right.hardConflict) ||
    Number(left.crossTypeOverlap) - Number(right.crossTypeOverlap) ||
    compareRoute(left.route, right.route) ||
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

async function reconcileEarlierExistingReviewOverlaps(
  input: RecommendBatchInput,
  results: RecommendationResult[],
) {
  const targetById = new Map(input.targets.map((target) => [target.id, target]));
  let assignments = [
    ...(input.existingAssignments ?? []),
    ...results.filter((result) => result.status === "recommended").map((result) =>
      asAssignment(targetById.get(result.targetId)!, result),
    ),
  ];

  for (const result of results) {
    const target = targetById.get(result.targetId);
    const reviewer = result.experiencedReviewer;
    if (!target || target.kind !== "existing" || result.status !== "recommended" || !result.date || !reviewer) continue;
    const hasOverlap = assignments.some((assignment) =>
      assignment.kind === "new" && assignment.date === result.date && assignment.participants.includes(reviewer.id),
    );
    if (!hasOverlap) continue;

    const withoutCurrent = assignments.filter((assignment) => assignment.targetId !== target.id);
    const tryDate = async (date: string) => {
      if (input.availability.isBlocked(target.responsible.id, date)) return null;
      if (newFieldCount(withoutCurrent, target.responsible.id, date) > 0) return null;
      if (existingResponsibleCount(withoutCurrent, target.responsible.id, date) >= 3) return null;
      const choice = await chooseReviewer(
        target, date, input.experiencedUsers, withoutCurrent, input.availability, input.routes, 1,
      );
      return choice && !choice.hardConflict && !choice.crossTypeOverlap ? choice : null;
    };

    let nextDate = result.date;
    let choice = await tryDate(nextDate);
    if (!choice) {
      for (const candidate of targetRecommendationDates(target)) {
        if (candidate.date === result.date) continue;
        choice = await tryDate(candidate.date);
        if (!choice) continue;
        nextDate = candidate.date;
        result.evidence.workingDaysBefore = candidate.workingDaysBefore;
        result.evidence.range = candidateRange(target, candidate.workingDaysBefore);
        result.reason = `${result.evidence.range === "primary" ? "기본구간" : "후순위구간"} -${candidate.workingDaysBefore} 워킹데이; 기존업체 배정 규칙; 신규 현장 중복 회피`;
        break;
      }
    }

    if (choice) {
      result.date = nextDate;
      result.experiencedReviewer = choice.user;
      result.participants = [target.responsible, choice.user];
      result.evidence.crossTypeOverlap = false;
      result.evidence.crossTypeOverlapAvoided = true;
      result.evidence.crossTypeOverlapReason = null;
      result.evidence.experiencedNewAssignments = newFieldCount(withoutCurrent, choice.user.id);
      result.evidence.experiencedAllFieldAssignments = allFieldCount(withoutCurrent, choice.user.id);
      assignments = [...withoutCurrent, asAssignment(target, result)];
    } else {
      result.evidence.crossTypeOverlap = true;
      result.evidence.crossTypeOverlapReason = "unavoidable_cross_type_overlap";
    }
  }
  for (const result of results) {
    const target = targetById.get(result.targetId);
    if (target?.kind !== "new") continue;
    const participantIds = new Set(result.participants.map((user) => user.id));
    const externalOverlap = (input.existingAssignments ?? []).some((assignment) =>
      assignment.kind === "existing" && assignment.date === result.date &&
      assignment.experiencedReviewerId !== null && participantIds.has(assignment.experiencedReviewerId),
    );
    result.evidence.crossTypeOverlap = externalOverlap;
    result.evidence.crossTypeOverlapAvoided = false;
    result.evidence.crossTypeOverlapReason = externalOverlap ? "unavoidable_cross_type_overlap" : null;
  }
}

function responsibleDailyCount(assignments: ExistingAssignment[], userId: number, date: string) {
  return assignments.filter((item) => item.date === date && item.responsibleUserId === userId).length;
}

function responsibleTotalCount(assignments: ExistingAssignment[], userId: number) {
  return assignments.filter((item) => item.responsibleUserId === userId).length;
}

function candidateRange(target: SurveyTarget, workingDaysBefore: number): "primary" | "fallback" {
  if (target.businessType === "external_new") return workingDaysBefore <= 30 ? "primary" : "fallback";
  if (target.businessType === "first_measurement" || target.businessType === "existing") return "primary";
  return workingDaysBefore >= 20 ? "primary" : "fallback";
}

function candidateDateGroups(
  target: SurveyTarget,
  dates: ReturnType<typeof targetRecommendationDates>,
) {
  if (target.businessType === "external_new") {
    return [
      dates.filter((candidate) => candidate.workingDaysBefore <= 30),
      dates.filter((candidate) => candidate.workingDaysBefore > 30),
    ];
  }
  if (target.businessType === "first_measurement" || target.businessType === "existing") return [dates];
  return [
    dates.filter((candidate) => candidate.workingDaysBefore >= 20),
    dates.filter((candidate) => candidate.workingDaysBefore < 20),
  ];
}

async function optimizeExistingFieldVisits(
  input: RecommendBatchInput,
  results: RecommendationResult[],
) {
  const targetById = new Map(input.targets.map((target) => [target.id, target]));
  for (const result of results) {
    const target = targetById.get(result.targetId);
    if (!target || target.kind !== "existing" || result.status !== "recommended" || !result.date) continue;
    const mandatoryCandidates = results.filter((candidate) => {
      const candidateTarget = targetById.get(candidate.targetId);
      return candidateTarget?.kind === "new" && candidate.status === "recommended" && candidate.date === result.date;
    });
    if (!mandatoryCandidates.length) continue;
    const fieldCount = (userId: number) => fieldVisitCount([
      ...(input.existingAssignments ?? []),
      ...results.filter((candidate) => candidate.status === "recommended").map((candidate) =>
        asAssignment(targetById.get(candidate.targetId)!, candidate)),
    ], userId, result.date!);
    const evaluated = await Promise.all(mandatoryCandidates.flatMap(async (mandatory) => {
      if (mandatory.participants.some((participant) => fieldCount(participant.id) >= 2)) return [];
      const mandatoryTarget = targetById.get(mandatory.targetId)!;
      const sameAddress = String(mandatoryTarget.address ?? "").replace(/\s+/g, "") !== "" &&
        String(mandatoryTarget.address ?? "").replace(/\s+/g, "") === String(target.address ?? "").replace(/\s+/g, "");
      const route = await evaluateSameDayRoute(mandatoryTarget, target, input.routes);
      const nearby = route.evidence.routeSource === "vehicle" && route.evidence.routeDecision === "same_day_allowed" &&
        (route.evidence.selectedRouteMinutes ?? Number.MAX_SAFE_INTEGER) <= SAME_ROUTE_THRESHOLD_MINUTES;
      if (!sameAddress && !nearby) return [];
      return [{ mandatory, route, sameAddress }];
    }));
    const selected = evaluated.flat().sort((left, right) =>
      Number(!left.sameAddress) - Number(!right.sameAddress) ||
      (left.route.evidence.selectedRouteMinutes ?? Number.MAX_SAFE_INTEGER) -
        (right.route.evidence.selectedRouteMinutes ?? Number.MAX_SAFE_INTEGER) ||
      left.mandatory.targetId - right.mandatory.targetId,
    )[0];
    if (!selected) continue;

    const { mandatory, route, sameAddress } = selected;
    result.participants = [...mandatory.participants];
    result.responsible = mandatory.participants.find((participant) => !participant.experienced) ?? mandatory.responsible;
    result.experiencedReviewer = mandatory.participants.find((participant) =>
      participant.experienced && participant.id !== result.responsible.id,
    ) ?? null;
    result.surveyMethod = "field";
    result.evidence.surveyMethod = "field";
    result.evidence.route = route.selectedRoute;
    result.evidence.sameDayRoute = route.evidence;
    result.reason = `${result.reason}; ${sameAddress ? "동일주소 묶음" : "근거리 묶음"}; 기존업체 선택 방문`;
  }
}

export async function recommendBatch(input: RecommendBatchInput): Promise<RecommendationResult[]> {
  const virtual = [...(input.existingAssignments ?? [])];
  const results: RecommendationResult[] = [];

  for (const target of deterministicTargets(input.targets)) {
    // service에서 별도 조사자 planner를 한 번 더 실행하지 않는다. 책임 조사자 후보와
    // 날짜·용량·경로를 이 planner의 같은 virtual assignment에서 함께 결정한다.
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
      if (input.availability.isBlocked(planningTarget.responsible.id, candidate.date)) return null;
      if (target.kind === "existing") {
        if (newFieldCount(virtual, planningTarget.responsible.id, candidate.date) > 0) return null;
        if (existingResponsibleCount(virtual, planningTarget.responsible.id, candidate.date) >= 3) return null;
      } else {
        const dailyFieldVisits = fieldVisitCount(virtual, planningTarget.responsible.id, candidate.date);
        if (dailyFieldVisits >= capacityPass || dailyFieldVisits >= 2) return null;
      }

      // 신규 방문만 비경력자 단독을 금지한다. 기존업체 유선은 개인별 하루 3건 용량만 적용한다.
      const requiresReviewer = target.kind === "new" && !planningTarget.responsible.experienced;
      const reviewerChoice = requiresReviewer
        ? await chooseReviewer(planningTarget, candidate.date, input.experiencedUsers, virtual, input.availability, input.routes, capacityPass)
        : null;
      if (requiresReviewer && (!reviewerChoice || reviewerChoice.hardConflict)) {
        if (reviewerChoice?.route && reviewerChoice.route.evidence.routeDecision !== "same_day_allowed") {
          rejectedSameDayRoutes.push(reviewerChoice.route.evidence);
        }
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
            break;
          }
          if (!sameDayRoute || (evaluated.evidence.selectedRouteMinutes ?? 0) > (sameDayRoute.selectedRouteMinutes ?? 0)) {
            sameDayRoute = evaluated.evidence;
            route = evaluated.selectedRoute;
          }
        }
        if (requiresRoute && sameDayRoute?.routeDecision !== "same_day_allowed") return null;
        if (participants.some((userId) => fieldVisitCount(virtual, userId, candidate.date) >= capacityPass)) return null;
      }

      const reviewer = reviewerChoice?.user ?? null;
      const crossTypeOverlap = target.kind === "new"
        ? existingReviewCount(virtual, planningTarget.responsible.id, candidate.date) > 0 || Boolean(reviewerChoice?.crossTypeOverlap)
        : Boolean(reviewerChoice?.crossTypeOverlap);
      const evidence: RecommendationEvidence = {
        classificationSource: target.classificationSource,
        processChangedPolicyApplicable: target.processChangedPolicyApplicable === true,
        surveyMethod: surveyMethodForKind(target.kind),
        workingDaysBefore: candidate.workingDaysBefore,
        range: candidateRange(target, candidate.workingDaysBefore),
        capacityPass,
        responsibleConflict: false,
        reviewerConflict: false,
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
        warnings: [holidayCoverageWarning(target.measurementDate)].filter((value): value is string => Boolean(value)),
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
        reason: `${evidence.range === "primary" ? "기본구간" : "후순위구간"} -${candidate.workingDaysBefore} 워킹데이`,
      };
    };

    const evaluateForResponsible = async (candidate: (typeof dates)[number], capacityPass: 1 | 2) => {
      const feasible: RecommendationResult[] = [];
      for (const responsible of responsibleCandidates) {
        const result = await evaluateCandidate({ ...target, responsible }, candidate, capacityPass);
        if (result) feasible.push(result);
      }
      feasible.sort((left, right) =>
        responsibleDailyCount(virtual, left.responsible.id, candidate.date) -
          responsibleDailyCount(virtual, right.responsible.id, candidate.date) ||
        responsibleTotalCount(virtual, left.responsible.id) - responsibleTotalCount(virtual, right.responsible.id) ||
        left.participants.length - right.participants.length ||
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

    let routeAlternative: RecommendationResult | null = null;
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
          routeAlternative ??= pairCandidates[0];
        }
        if (selected) break;
      }
    }
    if (!selected && routeAlternative) {
      routeAlternative.status = "manual_required";
      routeAlternative.date = null;
      routeAlternative.participants = [];
      routeAlternative.experiencedReviewer = null;
      routeAlternative.evidence.capacityPass = null;
      routeAlternative.evidence.selectionMode = "two_job_fallback";
      routeAlternative.evidence.selectionReason = "two_job_fallback_no_single_day";
      routeAlternative.evidence.singleCandidateAvailable = false;
      routeAlternative.evidence.sameRouteMinutes = routeAlternative.evidence.sameDayRoute?.selectedRouteMinutes ?? null;
      routeAlternative.evidence.warnings.push("ROUTE_ALTERNATIVE_REQUIRES_MANAGER");
      routeAlternative.reason = "31~60분 차량 이동 대안이 있으나 자동추천하지 않습니다.";
      selected = routeAlternative;
    }

    if (selected?.status === "recommended" && selected.date) virtual.push(asAssignment(target, selected));

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
        selectionReason: rejectedSameDayRoutes.some((route) => route.routeDecision === "both_directions_over_60")
          ? "over_60_rejected"
          : rejectedSameDayRoutes.length ? "route_unverified_rejected" : "no_available_date",
        crossTypeOverlap: false,
        crossTypeOverlapAvoided: false,
        crossTypeOverlapReason: null,
        warnings: ["NO_AVAILABLE_DATE_THROUGH_MINUS_3"],
      },
      reason: "-3 워킹데이까지 추천 가능한 날짜가 없습니다.",
    });
  }
  await reconcileEarlierExistingReviewOverlaps(input, results);
  // 필수 신규 방문을 먼저 고정한 뒤에만 기존업체를 같은 날 보조 방문으로 승격한다.
  // 조건이 맞지 않으면 기존업체는 유선 기본을 유지해 별도 방문일을 만들지 않는다.
  await optimizeExistingFieldVisits(input, results);
  return results;
}
