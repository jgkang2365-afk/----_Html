export type BusinessKind = "new" | "existing";

export interface Coordinate { latitude: number; longitude: number }
export interface SurveyUser {
  id: number;
  name: string;
  experienced: boolean;
  active?: boolean;
}
export interface SurveyTarget {
  id: number;
  code: string;
  name: string;
  kind: BusinessKind;
  measurementDate: string;
  responsible: SurveyUser;
  address: string | null;
  region: string | null;
  coordinate: Coordinate | null;
  createdAt: string | null;
  classificationSource?: {
    journalId: number | null;
    rawValue: string | null;
    measurementYear: number;
    measurementPeriod: string;
  };
}
export interface ExistingAssignment {
  targetId: number;
  businessCode: string;
  kind: BusinessKind;
  date: string;
  participants: number[];
  responsibleUserId: number;
  experiencedReviewerId: number | null;
  coordinate: Coordinate | null;
  region: string | null;
}
export interface RouteMetric {
  source: "vehicle" | "distance" | "region" | "unknown";
  durationMinutes: number | null;
  distanceKm: number | null;
  sameRegion: boolean;
}
export type SameDayRouteDecision =
  | "same_day_allowed"
  | "both_directions_over_60"
  | "forward_direction_unavailable"
  | "reverse_direction_unavailable"
  | "both_directions_failed";
export interface SameDayRouteEvidence {
  firstBusinessCode: string;
  secondBusinessCode: string;
  routeABMinutes: number | null;
  routeBAMinutes: number | null;
  selectedRouteMinutes: number | null;
  selectedVisitOrder: [string, string] | null;
  routeDecision: SameDayRouteDecision;
  routeSource: "vehicle" | "unverified";
}
export interface RecommendationEvidence {
  workingDaysBefore: number | null;
  range: "primary" | "fallback" | null;
  capacityPass: 1 | 2 | null;
  responsibleConflict: boolean;
  reviewerConflict: boolean;
  route: RouteMetric | null;
  sameDayRoute: SameDayRouteEvidence | null;
  rejectedSameDayRoutes: SameDayRouteEvidence[];
  singleCandidateAvailable: boolean;
  sameRouteMinutes: number | null;
  sameRouteThresholdMinutes: 30;
  hardMaximumMinutes: 60;
  selectionMode: "single" | "same_route_preferred" | "two_job_fallback" | null;
  selectionReason:
    | "single_available"
    | "same_route_preferred_under_30"
    | "single_day_preferred_over_30"
    | "two_job_fallback_no_single_day"
    | "over_60_rejected"
    | "route_unverified_rejected"
    | "no_available_date";
  experiencedNewAssignments: number | null;
  experiencedAllFieldAssignments: number | null;
  warnings: string[];
}
export interface RecommendationResult {
  targetId: number;
  status: "recommended" | "manual_required";
  date: string | null;
  participants: SurveyUser[];
  responsible: SurveyUser;
  experiencedReviewer: SurveyUser | null;
  evidence: RecommendationEvidence;
  reason: string;
}
export interface Availability {
  isBlocked(userId: number, date: string): boolean;
}
export interface RouteMetrics {
  between(left: SurveyTarget | ExistingAssignment, right: SurveyTarget | ExistingAssignment): Promise<RouteMetric>;
}
