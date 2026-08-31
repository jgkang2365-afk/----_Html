import { holidayCoverageWarning, recommendationDates, recommendationDatesForBusinessType } from "./calendar";
import { evaluateSameDayRoute, type EvaluatedSameDayRoute } from "./route-policy";
import type {
  Availability, ExistingAssignment, RecommendationEvidence, RecommendationResult,
  RouteMetric, RouteMetrics, SameDayRouteEvidence, SurveyTarget, SurveyUser,
} from "./types";
import { surveyMethodForKind } from "./types";
import { isExistingPhoneResponsibleBlocked, isFieldParticipantBlocked } from "./availability-policy";
import { allocateExistingPhoneDates } from "./existing-phone-date-allocation";

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
    .filter((user) => user.active !== false && user.experienced && user.id !== target.responsible.id)
    .map(async (user) => {
      const sameDayFieldCount = fieldVisitCount(assignments, user.id, date);
      const route = target.kind === "new" && capacityPass === 2
        ? await routeAgainstSameDayField(target, user.id, date, assignments, routes)
        : null;
      const hardBlockReasons = [
        ...(target.kind === "new" && isFieldParticipantBlocked(availability, user.id, date)
          ? availability.blockedReason?.(user.id, date) ?? ["SCHEDULE_OR_ACTUAL_MEASUREMENT_BLOCK"]
          : []),
        target.kind === "new" && sameDayFieldCount >= capacityPass
          ? "FIELD_CAPACITY_EXCEEDED"
          : null,
        target.kind === "new" && sameDayFieldCount > 0 && route?.evidence.routeDecision !== "same_day_allowed"
          ? "SAME_DAY_ROUTE_BLOCKED"
          : null,
      ].filter((value): value is string => Boolean(value));
      return {
        user,
        hardConflict: hardBlockReasons.length > 0,
        hardBlockReasons,
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
    Number(left.hardConflict) - Number(right.hardConflict) ||
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
    choices,
    crossTypeOverlapAvoided: !selected.crossTypeOverlap && choices.some((choice) => !choice.hardConflict && choice.crossTypeOverlap),
  } : null;
}

function responsibleDailyCount(assignments: ExistingAssignment[], userId: number, date: string) {
  return assignments.filter((item) => item.date === date && item.responsibleUserId === userId).length;
}

function responsibleTotalCount(assignments: ExistingAssignment[], userId: number) {
  return assignments.filter((item) => item.responsibleUserId === userId).length;
}

function normalizedAddress(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, "").trim();
}

function sameAddressSelectedCount(
  assignments: ExistingAssignment[], target: SurveyTarget, userId: number, preliminaryDate: string,
) {
  const address = normalizedAddress(target.address);
  if (!address) return 0;
  return assignments.filter((assignment) => assignment.date === preliminaryDate &&
    assignment.responsibleUserId === userId && normalizedAddress(assignment.address) === address).length;
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
      // 선택 방문은 allocator가 확정한 예비조사 역할을 바꾸지 않고, 같은 수행자가
      // 이미 필수 방문에 포함된 경우에만 방식만 field로 승격한다.
      if (!result.participants.every((participant) =>
        mandatory.participants.some((mandatoryParticipant) => mandatoryParticipant.id === participant.id))) return [];
      if (mandatory.participants.some((participant) => fieldCount(participant.id) >= 2)) return [];
      const mandatoryTarget = targetById.get(mandatory.targetId)!;
      const sameAddress = normalizedAddress(mandatoryTarget.address) !== "" &&
        normalizedAddress(mandatoryTarget.address) === normalizedAddress(target.address);
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
    result.surveyMethod = "field";
    result.evidence.surveyMethod = "field";
    result.evidence.route = route.selectedRoute;
    result.evidence.sameDayRoute = route.evidence;
    result.reason = `${result.reason}; ${sameAddress ? "동일주소 묶음" : "근거리 묶음"}; 기존업체 선택 방문`;
  }
}

type ExistingPhoneAllocationFailureReason =
  | "NO_VALID_PRIMARY_OR_FALLBACK"
  | "RESPONSIBLE_SCHEDULE_BLOCKED_ALL_DATES"
  | "RESPONSIBLE_CAPACITY_EXHAUSTED"
  | "NO_EXPERIENCED_REVIEWER_AVAILABLE"
  | "NO_ACTIVE_RESPONSIBLE";

function existingPhoneManualRequired(
  target: SurveyTarget,
  reasonCode: ExistingPhoneAllocationFailureReason,
): RecommendationResult {
  return {
    targetId: target.id,
    status: "manual_required",
    date: null,
    participants: [],
    responsible: target.responsible,
    experiencedReviewer: null,
    surveyMethod: "phone",
    evidence: {
      classificationSource: target.classificationSource,
      processChangedPolicyApplicable: target.processChangedPolicyApplicable === true,
      surveyMethod: "phone",
      workingDaysBefore: null,
      range: null,
      capacityPass: null,
      responsibleConflict: true,
      reviewerConflict: reasonCode === "NO_EXPERIENCED_REVIEWER_AVAILABLE",
      route: null,
      sameDayRoute: null,
      rejectedSameDayRoutes: [],
      singleCandidateAvailable: false,
      sameRouteMinutes: null,
      sameRouteThresholdMinutes: SAME_ROUTE_THRESHOLD_MINUTES,
      hardMaximumMinutes: HARD_MAXIMUM_MINUTES,
      selectionMode: null,
      selectionReason: "no_available_date",
      experiencedNewAssignments: null,
      experiencedAllFieldAssignments: null,
      crossTypeOverlap: false,
      crossTypeOverlapAvoided: false,
      crossTypeOverlapReason: null,
      warnings: [reasonCode],
    },
    reason: `기존업체 유선 전역 배정 실패: ${reasonCode}`,
  };
}

/**
 * 기존업체 유선의 authoritative planner. 모든 target의 hard-valid
 * (date, responsible) edge를 먼저 만든 뒤 date와 responsible를 동시에 확정한다.
 */
async function recommendExistingPhoneGlobally(
  input: RecommendBatchInput,
  baseAssignments: ExistingAssignment[],
): Promise<RecommendationResult[]> {
  const targets = deterministicTargets(input.targets.filter((target) => target.kind === "existing"));
  if (!targets.length) return [];

  const activeSurveyors = (input.surveyors?.length ? input.surveyors : targets.map((target) => target.responsible))
    .filter((user, index, users) =>
      user.active !== false && users.findIndex((candidate) => candidate.id === user.id) === index)
    .sort((left, right) => left.id - right.id);
  const activeExperienced = input.experiencedUsers
    .filter((user) => user.active !== false && user.experienced)
    .sort((left, right) => left.id - right.id);
  const failureByTarget = new Map<number, ExistingPhoneAllocationFailureReason>();
  const candidateTargets = targets.flatMap((target) => {
    const dates = targetRecommendationDates(target);
    if (!dates.length) {
      failureByTarget.set(target.id, "NO_VALID_PRIMARY_OR_FALLBACK");
      return [];
    }
    if (!activeSurveyors.length) {
      failureByTarget.set(target.id, "NO_ACTIVE_RESPONSIBLE");
      return [];
    }
    const roleValidResponsibles = activeSurveyors.filter((responsible) =>
      responsible.experienced || activeExperienced.some((reviewer) => reviewer.id !== responsible.id));
    if (!roleValidResponsibles.length) {
      failureByTarget.set(target.id, "NO_EXPERIENCED_REVIEWER_AVAILABLE");
      return [];
    }
    const candidates = dates.flatMap((candidate) => roleValidResponsibles
      .filter((responsible) =>
        !isExistingPhoneResponsibleBlocked(input.availability, responsible.id, candidate.date))
      .map((responsible) => ({
        date: candidate.date,
        responsibleUserId: responsible.id,
        workingDaysBefore: candidate.workingDaysBefore,
        primary: candidateRange(target, candidate.workingDaysBefore) === "primary",
      })));
    if (!candidates.length) {
      failureByTarget.set(target.id, "RESPONSIBLE_SCHEDULE_BLOCKED_ALL_DATES");
      return [];
    }
    return [{ targetId: target.id, candidates }];
  });

  const selections = allocateExistingPhoneDates(candidateTargets, baseAssignments);
  const userById = new Map(activeSurveyors.map((user) => [user.id, user]));
  const roleVirtual = [...baseAssignments];
  const results: RecommendationResult[] = [];

  for (const target of targets) {
    const selection = selections.get(target.id);
    if (!selection) {
      results.push(existingPhoneManualRequired(
        target,
        failureByTarget.get(target.id) ?? "RESPONSIBLE_CAPACITY_EXHAUSTED",
      ));
      continue;
    }
    const responsible = userById.get(selection.responsibleUserId);
    const candidate = targetRecommendationDates(target).find((item) => item.date === selection.date);
    if (!responsible || !candidate) {
      results.push(existingPhoneManualRequired(target, "NO_VALID_PRIMARY_OR_FALLBACK"));
      continue;
    }
    const reviewerChoice = responsible.experienced ? null : await chooseReviewer(
      { ...target, responsible }, selection.date, activeExperienced,
      roleVirtual, input.availability, input.routes, 1,
    );
    if (!responsible.experienced && !reviewerChoice) {
      results.push(existingPhoneManualRequired(target, "NO_EXPERIENCED_REVIEWER_AVAILABLE"));
      continue;
    }
    const reviewer = reviewerChoice?.user ?? null;
    const range = candidateRange(target, candidate.workingDaysBefore);
    const result: RecommendationResult = {
      targetId: target.id,
      status: "recommended",
      date: selection.date,
      participants: reviewer ? [responsible, reviewer] : [responsible],
      responsible,
      experiencedReviewer: reviewer,
      surveyMethod: "phone",
      evidence: {
        classificationSource: target.classificationSource,
        processChangedPolicyApplicable: target.processChangedPolicyApplicable === true,
        surveyMethod: "phone",
        workingDaysBefore: candidate.workingDaysBefore,
        range,
        capacityPass: 1,
        responsibleConflict: false,
        reviewerConflict: false,
        route: null,
        sameDayRoute: null,
        rejectedSameDayRoutes: [],
        singleCandidateAvailable: true,
        sameRouteMinutes: null,
        sameRouteThresholdMinutes: SAME_ROUTE_THRESHOLD_MINUTES,
        hardMaximumMinutes: HARD_MAXIMUM_MINUTES,
        selectionMode: "single",
        selectionReason: "single_available",
        experiencedNewAssignments: reviewer ? newFieldCount(roleVirtual, reviewer.id) : null,
        experiencedAllFieldAssignments: reviewer ? allFieldCount(roleVirtual, reviewer.id) : null,
        crossTypeOverlap: false,
        crossTypeOverlapAvoided: false,
        crossTypeOverlapReason: null,
        warnings: [holidayCoverageWarning(target.measurementDate)].filter(
          (value): value is string => Boolean(value),
        ),
      },
      reason: `${range === "primary" ? "기본구간" : "후순위구간"} -${candidate.workingDaysBefore} 워킹데이; 전체 날짜·responsible 전역 배정`,
    };
    results.push(result);
    roleVirtual.push(asAssignment(target, result));
  }
  return results;
}

export async function recommendBatch(input: RecommendBatchInput): Promise<RecommendationResult[]> {
  const virtual = [...(input.existingAssignments ?? [])];
  const results: RecommendationResult[] = [];

  for (const target of deterministicTargets(input.targets.filter((candidate) => candidate.kind !== "existing"))) {
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
      const dailyFieldVisits = fieldVisitCount(virtual, planningTarget.responsible.id, candidate.date);
      if (dailyFieldVisits >= capacityPass || dailyFieldVisits >= 2) return null;

      // 업체 유형·방식과 관계없이 비경력자 단독은 hard block이다.
      const requiresExperiencedParticipant = !planningTarget.responsible.experienced;
      const reviewerChoice = requiresExperiencedParticipant
        ? await chooseReviewer(planningTarget, candidate.date, input.experiencedUsers, virtual, input.availability, input.routes, capacityPass)
        : null;
      if (requiresExperiencedParticipant && (!reviewerChoice || reviewerChoice.hardConflict)) {
        if (reviewerChoice?.route && reviewerChoice.route.evidence.routeDecision !== "same_day_allowed") {
          rejectedSameDayRoutes.push(reviewerChoice.route.evidence);
        }
        return null;
      }

      let route: RouteMetric | null = null;
      let sameDayRoute: SameDayRouteEvidence | null = null;
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

      const reviewer = reviewerChoice && !reviewerChoice.hardConflict ? reviewerChoice.user : null;
      const crossTypeOverlap = false;
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
        warnings: [
          holidayCoverageWarning(target.measurementDate),
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
        reason: `${evidence.range === "primary" ? "기본구간" : "후순위구간"} -${candidate.workingDaysBefore} 워킹데이`,
      };
    };

    const evaluateForResponsible = async (
      candidate: (typeof dates)[number],
      capacityPass: 1 | 2,
    ) => {
      const feasible: RecommendationResult[] = [];
      for (const responsible of responsibleCandidates) {
        const responsibleBlocked = isFieldParticipantBlocked(input.availability, responsible.id, candidate.date);
        if (responsibleBlocked) continue;
        const result = await evaluateCandidate(
          { ...target, responsible }, candidate, capacityPass,
        );
        if (result) feasible.push(result);
      }
      feasible.sort((left, right) =>
        sameAddressSelectedCount(virtual, target, right.responsible.id, candidate.date) -
          sameAddressSelectedCount(virtual, target, left.responsible.id, candidate.date) ||
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

    {
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
  const existingPhoneResults = await recommendExistingPhoneGlobally(input, virtual);
  results.push(...existingPhoneResults);
  // 필수 신규 방문을 먼저 고정한 뒤에만 기존업체를 같은 날 보조 방문으로 승격한다.
  // 조건이 맞지 않으면 기존업체는 유선 기본을 유지해 별도 방문일을 만들지 않는다.
  await optimizeExistingFieldVisits(input, results);
  return results;
}
