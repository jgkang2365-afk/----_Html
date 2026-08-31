export type BusinessKind = "new" | "existing";
export type SurveyMethod = "field" | "phone";

export function surveyMethodForKind(kind: BusinessKind): SurveyMethod {
  return kind === "new" ? "field" : "phone";
}

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
  /** 다일 사업장은 daily_staff에 명시된 모든 실제 측정일, 불완전하면 null. */
  measurementAssignmentDates?: string[] | null;
  responsible: SurveyUser;
  address: string | null;
  region: string | null;
  coordinate: Coordinate | null;
  createdAt: string | null;
  businessType?: "existing" | "first_measurement" | "external_new" | null;
  /** 기존 V2 stale-source 검증용 보고서 담당자 snapshot. 예비조사 responsible와는 별개다. */
  sourceMeasurerId?: number | null;
  /** 적용 draft stale 검증용 실제 측정 참여자 이름 snapshot. 역할 순서는 의미가 없다. */
  measurementParticipantsSnapshot?: string;
  /** apply 경쟁상태 검증용 원천. 역할 추론에는 사용하지 않는다. */
  sourceDailyStaffSnapshot?: unknown;
  /** legacy CSV 또는 JSON 배열 모두 가능한 측정 참여자 원천 snapshot. */
  sourceCollaboratorsSnapshot?: unknown;
  /** 추천 preference에만 사용하는 날짜별 원천 역할. 역할 자체를 서로 복사하지 않는다. */
  measurementStaffByDate?: Array<{
    date: string;
    reportWriterUserId: number | null;
    measurementParticipantUserIds: number[];
  }>;
  processChanged?: boolean | null;
  processChangedPolicyApplicable?: boolean;
  classificationSource?: {
    source: "target_business_type" | "legacy_journal" | "legacy_rule_type";
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
  /** 기존업체가 근거리 묶음으로 선택 방문이 된 경우에만 field. 이전 데이터는 kind 기본값을 쓴다. */
  surveyMethod?: SurveyMethod;
  address?: string | null;
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
  classificationSource: SurveyTarget["classificationSource"];
  /** 정책 적용 대상 판정만 기록하며, 이번 단계에서는 추천 행동을 바꾸지 않는다. */
  processChangedPolicyApplicable?: boolean;
  surveyMethod: SurveyMethod;
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
    | "document_integrity_unresolved"
    | "no_available_date";
  experiencedNewAssignments: number | null;
  experiencedAllFieldAssignments: number | null;
  crossTypeOverlap: boolean;
  crossTypeOverlapAvoided: boolean;
  crossTypeOverlapReason: "unavoidable_cross_type_overlap" | null;
  warnings: string[];
}
export interface RecommendationResult {
  targetId: number;
  status: "recommended" | "manual_required";
  date: string | null;
  participants: SurveyUser[];
  responsible: SurveyUser;
  experiencedReviewer: SurveyUser | null;
  surveyMethod: SurveyMethod;
  evidence: RecommendationEvidence;
  reason: string;
}
export interface Availability {
  isBlocked(userId: number, date: string): boolean;
  blockedReason?(userId: number, date: string): string[];
}
export interface RouteMetrics {
  between(left: SurveyTarget | ExistingAssignment, right: SurveyTarget | ExistingAssignment): Promise<RouteMetric>;
  stats?: {
    requests: number;
    externalCalls: number;
    successes: number;
    failures: number;
    sessionCacheHits: number;
    sharedCacheHits: number;
    coordinateUnavailable: number;
  };
}
