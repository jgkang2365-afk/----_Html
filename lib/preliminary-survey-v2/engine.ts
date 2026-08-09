import { holidayCoverageWarning, recommendationDates } from "./calendar";
import type {
  Availability, ExistingAssignment, RecommendationEvidence, RecommendationResult,
  RouteMetric, RouteMetrics, SameDayRouteEvidence, SurveyTarget, SurveyUser,
} from "./types";

export interface RecommendBatchInput {
  targets: SurveyTarget[];
  experiencedUsers: SurveyUser[];
  existingAssignments?: ExistingAssignment[];
  availability: Availability;
  routes: RouteMetrics;
}

function deterministicTargets(targets: SurveyTarget[]) {
  return [...targets].sort((left, right) =>
    left.measurementDate.localeCompare(right.measurementDate) ||
    (left.kind === right.kind ? 0 : left.kind === "new" ? -1 : 1) ||
    (left.createdAt ?? "9999").localeCompare(right.createdAt ?? "9999") ||
    left.id - right.id,
  );
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

function hasExistingFieldResponsibility(assignments: ExistingAssignment[], userId: number, date: string) {
  return assignments.some((item) =>
    item.kind === "existing" && item.date === date && item.responsibleUserId === userId,
  );
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
    responsibleUserId: target.responsible.id,
    experiencedReviewerId: result.experiencedReviewer?.id ?? null,
    coordinate: target.coordinate,
    region: target.region,
  };
}

interface EvaluatedSameDayRoute {
  evidence: SameDayRouteEvidence;
  selectedRoute: RouteMetric | null;
}

async function routeAgainstSameDayNew(
  target: SurveyTarget,
  userId: number,
  date: string,
  assignments: ExistingAssignment[],
  routes: RouteMetrics,
): Promise<EvaluatedSameDayRoute | null> {
  const other = assignments.find((item) =>
    item.kind === "new" && item.date === date && item.participants.includes(userId),
  );
  if (!other) return null;

  const [routeAB, routeBA] = await Promise.all([
    routes.between(other, target),
    routes.between(target, other),
  ]);
  const routeABMinutes = routeAB.source === "vehicle" ? routeAB.durationMinutes : null;
  const routeBAMinutes = routeBA.source === "vehicle" ? routeBA.durationMinutes : null;
  const successful = [
    routeABMinutes === null ? null : { minutes: routeABMinutes, order: [other.businessCode, target.code] as [string, string], route: routeAB },
    routeBAMinutes === null ? null : { minutes: routeBAMinutes, order: [target.code, other.businessCode] as [string, string], route: routeBA },
  ].filter((item): item is { minutes: number; order: [string, string]; route: RouteMetric } => item !== null)
    .sort((left, right) => left.minutes - right.minutes || left.order.join("->").localeCompare(right.order.join("->")));
  const selected = successful[0] ?? null;
  let routeDecision: SameDayRouteEvidence["routeDecision"];
  if (routeABMinutes !== null && routeBAMinutes !== null) {
    routeDecision = selected!.minutes <= 60 ? "same_day_allowed" : "both_directions_over_60";
  } else if (selected?.minutes !== undefined && selected.minutes <= 60) {
    routeDecision = "same_day_allowed";
  } else if (routeABMinutes !== null) {
    routeDecision = "reverse_direction_unavailable";
  } else if (routeBAMinutes !== null) {
    routeDecision = "forward_direction_unavailable";
  } else {
    routeDecision = "both_directions_failed";
  }
  return {
    evidence: {
      firstBusinessCode: other.businessCode,
      secondBusinessCode: target.code,
      routeABMinutes,
      routeBAMinutes,
      selectedRouteMinutes: selected?.minutes ?? null,
      selectedVisitOrder: routeDecision === "same_day_allowed" ? selected!.order : null,
      routeDecision,
      routeSource: selected ? "vehicle" : "unverified",
    },
    selectedRoute: routeDecision === "same_day_allowed" ? selected!.route : null,
  };
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
      const sameDayNewCount = newFieldCount(assignments, user.id, date);
      const route = target.kind === "new" && capacityPass === 2
        ? await routeAgainstSameDayNew(target, user.id, date, assignments, routes)
        : null;
      return {
        user,
        blocked: availability.isBlocked(user.id, date),
        hardConflict: availability.isBlocked(user.id, date) || (
          target.kind === "new" && (
            sameDayNewCount >= capacityPass ||
            hasExistingFieldResponsibility(assignments, user.id, date) ||
            (sameDayNewCount > 0 && route?.evidence.routeDecision !== "same_day_allowed")
          )
        ),
        route,
        newCount: newFieldCount(assignments, user.id),
        allFieldCount: allFieldCount(assignments, user.id),
      };
    }));
  choices.sort((left, right) =>
    Number(left.hardConflict) - Number(right.hardConflict) ||
    compareRoute(left.route, right.route) ||
    left.newCount - right.newCount ||
    left.allFieldCount - right.allFieldCount ||
    left.user.id - right.user.id,
  );
  return choices[0] ?? null;
}

export async function recommendBatch(input: RecommendBatchInput): Promise<RecommendationResult[]> {
  const virtual = [...(input.existingAssignments ?? [])];
  const results: RecommendationResult[] = [];

  for (const target of deterministicTargets(input.targets)) {
    let selected: RecommendationResult | null = null;
    const rejectedSameDayRoutes: SameDayRouteEvidence[] = [];
    // 날짜 우선순위를 지키되, 같은 날짜의 차량 60분 이내 묶음만 pass 2 예외를 허용한다.
    for (const candidate of recommendationDates(target.measurementDate)) {
      for (const capacityPass of [1, 2] as const) {
        if (target.kind === "existing" && capacityPass === 2) continue;
        if (input.availability.isBlocked(target.responsible.id, candidate.date)) continue;
        if (target.kind === "existing") {
          if (newFieldCount(virtual, target.responsible.id, candidate.date) > 0) continue;
          if (existingResponsibleCount(virtual, target.responsible.id, candidate.date) >= 3) continue;
        } else {
          if (hasExistingFieldResponsibility(virtual, target.responsible.id, candidate.date)) continue;
          const dailyNew = newFieldCount(virtual, target.responsible.id, candidate.date);
          if (dailyNew >= capacityPass || dailyNew >= 2) continue;
        }

        const reviewerChoice = target.responsible.experienced
          ? null
          : await chooseReviewer(target, candidate.date, input.experiencedUsers, virtual, input.availability, input.routes, capacityPass);
        if (!target.responsible.experienced && (!reviewerChoice || reviewerChoice.hardConflict)) continue;

        let route: RouteMetric | null = null;
        let sameDayRoute: SameDayRouteEvidence | null = null;
        if (target.kind === "new") {
          const participants = [target.responsible.id, reviewerChoice?.user.id].filter((id): id is number => Boolean(id));
          const requiresRoute = participants.some((userId) => newFieldCount(virtual, userId, candidate.date) > 0);
          for (const userId of participants) {
            const evaluated = reviewerChoice?.user.id === userId && reviewerChoice.route
              ? reviewerChoice.route
              : await routeAgainstSameDayNew(target, userId, candidate.date, virtual, input.routes);
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
          if (requiresRoute && sameDayRoute?.routeDecision !== "same_day_allowed") continue;
          if (participants.some((userId) => newFieldCount(virtual, userId, candidate.date) >= capacityPass)) continue;
        }

        const reviewer = reviewerChoice?.user ?? null;
        const warnings = [holidayCoverageWarning(target.measurementDate)].filter((value): value is string => Boolean(value));
        const evidence: RecommendationEvidence = {
          workingDaysBefore: candidate.workingDaysBefore,
          range: candidate.workingDaysBefore >= 20 ? "primary" : "fallback",
          capacityPass,
          responsibleConflict: false,
          reviewerConflict: false,
          route,
          sameDayRoute,
          rejectedSameDayRoutes,
          experiencedNewAssignments: reviewer ? newFieldCount(virtual, reviewer.id) : null,
          experiencedAllFieldAssignments: reviewer ? allFieldCount(virtual, reviewer.id) : null,
          warnings,
        };
        selected = {
          targetId: target.id,
          status: "recommended",
          date: candidate.date,
          participants: reviewer ? [target.responsible, reviewer] : [target.responsible],
          responsible: target.responsible,
          experiencedReviewer: reviewer,
          evidence,
          reason: `${evidence.range === "primary" ? "기본구간" : "후순위구간"} -${candidate.workingDaysBefore} 워킹데이`,
        };
        virtual.push(asAssignment(target, selected));
        break;
      }
      if (selected) break;
    }

    results.push(selected ?? {
      targetId: target.id,
      status: "manual_required",
      date: null,
      participants: [],
      responsible: target.responsible,
      experiencedReviewer: null,
      evidence: {
        workingDaysBefore: null, range: null, capacityPass: null,
        responsibleConflict: true, reviewerConflict: !target.responsible.experienced,
        route: null, experiencedNewAssignments: null, experiencedAllFieldAssignments: null,
        sameDayRoute: null, rejectedSameDayRoutes,
        warnings: ["NO_AVAILABLE_DATE_THROUGH_MINUS_3"],
      },
      reason: "-3 워킹데이까지 추천 가능한 날짜가 없습니다.",
    });
  }
  return results;
}
