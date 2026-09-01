export const REVERSE_PLANNER_VERSION = "fixed-assignee-reverse-planner-v1.1.0";
export const PRELIMINARY_SURVEY_CANONICAL_SHA = "aca759e7d785231cc89bc656ba635eb367f65de3";

export type ReversePlannerDecision = "AUTO_ASSIGNED" | "MANUAL_REQUIRED" | "SOURCE_INVALID";
export type ReversePlannerMutation = "KEEP_EXISTING" | "CREATE" | "REPLACE" | "NONE";
export type ReversePlannerReason =
  | "FIXED_ASSIGNEE_NOT_CONFIRMED" | "ONLY_MISMATCH_ALTERNATIVES_AVAILABLE"
  | "NO_EXPERIENCED_PARTNER_AVAILABLE" | "NO_VALID_PRELIMINARY_DATE"
  | "ROUTE_EVIDENCE_REQUIRED" | "PROTECTED_PLAN_REQUIRES_REVIEW"
  | "TRANSITION_BOUNDARY_REVIEW_REQUIRED" | "SOURCE_CHANGED" | "TARGET_NOT_FOUND"
  | "USER_NOT_FOUND" | "INVALID_MEASUREMENT_DATES" | "INVALID_DAILY_STAFF"
  | "INVALID_BASE_CODE" | "CONFLICTING_AUTHORITATIVE_SOURCE";

export interface PlannerUser { id: number; name: string; active: boolean; experienced: boolean; baseCode: string | null }
export interface PlannerDay { date: string; collaboratorUserIds: number[]; reportWriterUserId: number | null }
export interface FixedMeasurementAssignment {
  targetId: number; measurementDate: string; assigneeUserId: number; confirmedAt: string; updatedAt: string;
  nonParticipantConfirmed?: boolean;
}
export interface ExistingPlannerPlan {
  id: string; preliminaryDate: string | null; surveyMethod: "field" | "phone"; participantUserIds: number[];
  responsibleUserId: number; reviewerUserId: number | null; protected: boolean; updatedAt: string;
  assignments: Array<{ measurementDate: string; assigneeUserId: number; surveyCode: string; publicSampleCode: string | null }>;
}
export interface PlannerTarget {
  id: number; code: string; name: string; address: string | null;
  businessType: "existing" | "first_measurement" | "external_new"; days: PlannerDay[];
  fixedAssignments: FixedMeasurementAssignment[]; existingPlan: ExistingPlannerPlan | null;
  sourceMeasurementDate?: string;
  sourceReportWriterUserId?: number | null;
  sourceCollaborators?: unknown;
  sourceDailyStaff?: unknown;
}
export interface PlannerScheduleBlock { userId: number; startDate: string; endDate: string }
export interface PlannerRouteEvidence {
  date: string; leftTargetId: number; rightTargetId: number; sameAddress: boolean;
  durationMinutes: number | null; provider: string; capturedAt: string;
}
export interface ExistingSurveyOccupancy {
  targetId: number; businessCode: string; address: string | null; preliminaryDate: string;
  surveyMethod: "field" | "phone"; participantUserIds: number[]; responsibleUserId: number;
  reviewerUserId: number | null; writerUserId: number | null; protected: boolean;
}
export interface ActualMeasurementOccupancy {
  targetId: number; businessCode: string; address: string | null; date: string; participantUserIds: number[];
}
export interface ExistingPublicSampleAssignment {
  targetId: number; businessCode: string; measurementDate: string; assigneeUserId: number;
  surveyCode: string; publicSampleCode: string | null; protected: boolean;
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
}
