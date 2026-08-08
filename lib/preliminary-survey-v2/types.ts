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
export interface RecommendationEvidence {
  workingDaysBefore: number | null;
  range: "primary" | "fallback" | null;
  capacityPass: 1 | 2 | null;
  responsibleConflict: boolean;
  reviewerConflict: boolean;
  route: RouteMetric | null;
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
