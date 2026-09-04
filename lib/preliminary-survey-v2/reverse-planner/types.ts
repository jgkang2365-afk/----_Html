export const REVERSE_PLANNER_VERSION = "fixed-assignee-reverse-planner-v1.3.6";
export const PRELIMINARY_SURVEY_CANONICAL_SHA = "1c0b66b33d5996d9d7810332cf86a37c027d5329";

export type ReversePlannerDecision = "AUTO_ASSIGNED" | "ADMIN_OVERRIDE_KEPT" | "MANUAL_REQUIRED" | "SOURCE_INVALID";
export type ReversePlannerMutation = "KEEP_EXISTING" | "CREATE" | "REPLACE" | "NONE";
export type ReversePlannerReason =
  | "FIXED_ASSIGNEE_NOT_CONFIRMED" | "ONLY_MISMATCH_ALTERNATIVES_AVAILABLE"
  | "NO_EXPERIENCED_PARTNER_AVAILABLE" | "NO_VALID_PRELIMINARY_DATE"
  | "ROUTE_EVIDENCE_REQUIRED" | "PROTECTED_PLAN_REQUIRES_REVIEW" | "ADMIN_OVERRIDE_SOURCE_CHANGED"
  | "TRANSITION_BOUNDARY_REVIEW_REQUIRED" | "SOURCE_CHANGED" | "TARGET_NOT_FOUND"
  | "USER_NOT_FOUND" | "INVALID_MEASUREMENT_DATES" | "INVALID_DAILY_STAFF"
  | "INVALID_BASE_CODE" | "CONFLICTING_AUTHORITATIVE_SOURCE"
  | "MEASUREMENT_ASSIGNMENT_ROUTE_REQUIRED"
  | "MEASUREMENT_ASSIGNMENT_THIRD_REQUIRES_OVERRIDE"
  | "MEASUREMENT_ASSIGNMENT_CAPACITY_EXCEEDED"
  | "MEASUREMENT_ASSIGNEE_INTERSECTION_REQUIRED";

export interface PlannerUser { id: number; name: string; active: boolean; experienced: boolean; baseCode: string | null }
export interface PlannerDay {
  date: string; collaboratorUserIds: number[]; reportWriterUserId: number | null;
  invalidCollaboratorNames?: string[]; invalidReportWriterUserId?: number | null;
}
export interface FixedMeasurementAssignment {
  targetId: number; measurementDate: string; assigneeUserId: number; confirmedAt: string; updatedAt: string;
  nonParticipantConfirmed?: boolean;
  /** automatic은 계산용 후보이며 fixed confirmation row가 아니다. */
  origin?: "confirmed" | "automatic";
}
export interface ExistingPlannerPlan {
  id: string; preliminaryDate: string | null; surveyMethod: "field" | "phone"; participantUserIds: number[];
  responsibleUserId: number; reviewerUserId: number | null; protected: boolean; updatedAt: string;
  assignments: Array<{ measurementDate: string; assigneeUserId: number; surveyCode: string; publicSampleCode: string | null }>;
}
export interface PlannerTarget {
  id: number; code: string; name: string; address: string | null;
  coordinate?: { latitude: number; longitude: number } | null;
  businessType: "existing" | "first_measurement" | "external_new"; days: PlannerDay[];
  fixedAssignments: FixedMeasurementAssignment[]; existingPlan: ExistingPlannerPlan | null;
  protected?: boolean;
  /** 관리자 ADMIN_EXPLICIT_OVERRIDE 자동변경 금지. */
  adminOverrideProtected?: boolean;
  /** 관리자 지정 당시 핵심 원천이 이후 변경됨. */
  adminOverrideSourceChanged?: boolean;
  sourceMeasurementDate?: string;
  sourceUpdatedAt?: string;
  sourceReportWriterUserId?: number | null;
  sourceCollaborators?: unknown;
  sourceDailyStaff?: unknown;
  automaticAssignmentIssue?: "MEASUREMENT_ASSIGNMENT_ROUTE_REQUIRED"
    | "MEASUREMENT_ASSIGNMENT_THIRD_REQUIRES_OVERRIDE"
    | "MEASUREMENT_ASSIGNMENT_CAPACITY_EXCEEDED";
}
export interface PlannerScheduleBlock { userId: number; startDate: string; endDate: string }
export interface PlannerRouteEvidence {
  date: string; leftTargetId: number; rightTargetId: number; sameAddress: boolean;
  durationMinutes: number | null; provider: string; capturedAt: string;
  forwardDurationMinutes?: number | null; reverseDurationMinutes?: number | null;
  effectiveDurationMinutes?: number | null;
  forwardProvider?: string; reverseProvider?: string;
  routeReason?: RouteRequirementReason; sharedUserIds?: number[];
}
export type RouteRequirementReason =
  | "ACTUAL_MEASUREMENT_TEAM_OVERLAP"
  | "PRELIMINARY_FIELD_VISIT_OVERLAP"
  | "EXISTING_FIELD_OCCUPANCY_OVERLAP"
  | "MEASUREMENT_ASSIGNEE_SECOND_ASSIGNMENT";
export interface RouteRequirement {
  date: string; leftTargetId: number; rightTargetId: number;
  reasons: RouteRequirementReason[]; sharedUserIds: number[];
}
export interface PlannerRouteStats {
  planningTargetCount: number; snapshotTargetCount: number; candidatePairs: number;
  requiredPairs: number; sameAddressResolved: number; cacheHits: number; negativeCacheHits: number;
  directionalRequests: number; externalCalls: number; routeSuccess: number; routeFailure: number;
  routeUnknown: number; guardedPairs: number; deadlinePairs: number;
}
export interface ExistingSurveyOccupancy {
  targetId: number; businessCode: string; address: string | null; preliminaryDate: string;
  coordinate?: { latitude: number; longitude: number } | null;
  surveyMethod: "field" | "phone"; participantUserIds: number[]; responsibleUserId: number;
  reviewerUserId: number | null; writerUserId: number | null; protected: boolean;
  planId?: string; updatedAt?: string;
}
export interface ActualMeasurementOccupancy {
  targetId: number; businessCode: string; address: string | null; date: string; participantUserIds: number[];
  coordinate?: { latitude: number; longitude: number } | null;
  targetUpdatedAt?: string; fixedUpdatedAts?: string[];
}
export interface ExistingPublicSampleAssignment {
  targetId: number; businessCode: string; measurementDate: string; assigneeUserId: number;
  surveyCode: string; publicSampleCode: string | null; protected: boolean;
  source: "persisted" | "fixed"; updatedAt: string;
}
export interface PlanningSnapshot {
  canonicalSha: string; plannerVersion: string; targets: PlannerTarget[]; users: PlannerUser[];
  scheduleBlocks: PlannerScheduleBlock[]; routeEvidence: PlannerRouteEvidence[]; writingCounters: Record<string, number>;
  existingSurveyOccupancy: ExistingSurveyOccupancy[];
  actualMeasurementOccupancy: ActualMeasurementOccupancy[];
  existingPublicSampleAssignments: ExistingPublicSampleAssignment[];
}
export type PlannerObjective = readonly [
  fallbackCount: number,
  changedPlanCount: number,
  phoneDateReuse: number,
  reviewerAndReportPenalty: number,
  writingLoad: number,
  longRouteCount: number,
];
export interface PlannerCandidate {
  preliminaryDate: string; surveyMethod: "field" | "phone"; participantUserIds: number[];
  responsibleUserId: number; reviewerUserId: number | null; writerUserId: number;
  objective: PlannerObjective; reasons: string[];
}
export interface PublicSampleAssignment {
  targetId: number; businessCode: string; measurementDate: string; assigneeUserId: number;
  surveyCode: string; publicSampleCode: string;
}
export interface ReversePlannerResult {
  targetId: number; code: string; decision: ReversePlannerDecision; mutation: ReversePlannerMutation;
  reason: ReversePlannerReason | null; candidate: PlannerCandidate | null;
  fixedAssignments: FixedMeasurementAssignment[]; publicSampleAssignments: PublicSampleAssignment[]; warnings: string[];
}
export interface ReversePlannerOutput {
  results: ReversePlannerResult[]; sourceFingerprint: string; canonicalSha: string; plannerVersion: string;
  solverTimedOut?: boolean;
  routeStats?: PlannerRouteStats;
  routeEvidence?: PlannerRouteEvidence[];
  previewToken?: string;
  routeProviderConfigured?: boolean;
}
