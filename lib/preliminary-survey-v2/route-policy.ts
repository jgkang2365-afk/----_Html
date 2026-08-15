import type {
  ExistingAssignment, RouteMetric, RouteMetrics, SameDayRouteEvidence, SurveyTarget,
} from "./types";

export interface EvaluatedSameDayRoute {
  evidence: SameDayRouteEvidence;
  selectedRoute: RouteMetric | null;
}

/** 신규 2건의 양방향 실제 차량시간 중 짧은 성공 경로로 60분 hard rule을 판정한다. */
export async function evaluateSameDayRoute(
  first: SurveyTarget | ExistingAssignment,
  second: SurveyTarget | ExistingAssignment,
  routes: RouteMetrics,
): Promise<EvaluatedSameDayRoute> {
  const firstCode = "code" in first ? first.code : first.businessCode;
  const secondCode = "code" in second ? second.code : second.businessCode;
  const [routeAB, routeBA] = await Promise.all([
    routes.between(first, second),
    routes.between(second, first),
  ]);
  const routeABMinutes = routeAB.source === "vehicle" ? routeAB.durationMinutes : null;
  const routeBAMinutes = routeBA.source === "vehicle" ? routeBA.durationMinutes : null;
  const successful = [
    routeABMinutes === null ? null : { minutes: routeABMinutes, order: [firstCode, secondCode] as [string, string], route: routeAB },
    routeBAMinutes === null ? null : { minutes: routeBAMinutes, order: [secondCode, firstCode] as [string, string], route: routeBA },
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
      firstBusinessCode: firstCode,
      secondBusinessCode: secondCode,
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
