export const NEW_PRELIMINARY_SURVEY_RULE_TYPES = [
  "general_new",
  "other_org_new",
  "unconfirmed_new",
] as const;

export type PreliminarySurveyRuleType =
  | "existing"
  | (typeof NEW_PRELIMINARY_SURVEY_RULE_TYPES)[number];

export type PreliminarySurveyVisitMode =
  | "existing_field_visit"
  | "experienced_solo_visit"
  | "joint_field_visit";

export type PreliminarySurveyPlanStatus =
  | "pending"
  | "recommended"
  | "confirmed"
  | "needs_review"
  | "cancelled";

export interface RecommendationUser {
  id: number;
  name: string;
  job?: string | null;
  is_active: boolean;
  is_preliminary_survey_experienced: boolean;
  is_preliminary_survey_support_assignable: boolean;
}

export interface ScheduleConflict {
  userId: number;
  date: string;
  kind: "none" | "same_region" | "different_region" | "unknown_region";
  businessName?: string;
}

export interface ScheduleBlock {
  user_id: number;
  start_date: string;
  end_date: string;
}

export interface CalendarRecommendationSignal {
  userId: number;
  date: string;
  kind: "preferred" | "occupied";
  eventId: string | null;
  eventUpdatedAt: string | null;
}

export interface WorkloadSummary {
  halfYear: number;
  recent30Days: number;
  byDate: Record<string, number>;
}

export interface RecommendationAlternative {
  date: string;
  experiencedUserId: number | null;
  experiencedUserName: string | null;
  score: number;
  warnings: string[];
}

export interface RecommendationResult {
  status: "pending" | "recommended";
  reason: string;
  recommendedDate: string | null;
  responsibleUserId: number;
  responsibleUserName: string;
  experiencedUserId: number | null;
  experiencedUserName: string | null;
  visitMode: PreliminarySurveyVisitMode | null;
  score: number | null;
  warnings: string[];
  alternatives: RecommendationAlternative[];
  reasonDetails: Record<string, unknown>;
}

export function isPreliminarySurveyRuleType(
  value: unknown,
): value is PreliminarySurveyRuleType {
  return (
    value === "existing" ||
    NEW_PRELIMINARY_SURVEY_RULE_TYPES.includes(
      value as (typeof NEW_PRELIMINARY_SURVEY_RULE_TYPES)[number],
    )
  );
}

export function requiresFieldPreliminarySurvey(
  ruleType: PreliminarySurveyRuleType,
): boolean {
  return ruleType !== "existing";
}

export function isNewPreliminarySurveyRule(
  ruleType: unknown,
): ruleType is (typeof NEW_PRELIMINARY_SURVEY_RULE_TYPES)[number] {
  return NEW_PRELIMINARY_SURVEY_RULE_TYPES.includes(
    ruleType as (typeof NEW_PRELIMINARY_SURVEY_RULE_TYPES)[number],
  );
}
