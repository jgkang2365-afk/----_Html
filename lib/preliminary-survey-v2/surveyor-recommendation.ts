import { surveyMethodForKind, type Availability, type BusinessKind, type ExistingAssignment, type SurveyMethod, type SurveyUser } from "./types";

export interface SurveyorRecommendationTarget {
  id: number;
  kind: BusinessKind;
  businessType?: "existing" | "first_measurement" | "external_new" | null;
  measurementDate: string;
  createdAt: string | null;
  candidateDates: string[];
}

export interface TentativeSurveyorAssignment extends ExistingAssignment {
  /** 현재 V2 가확정 plan에서 읽은 배정이면, 유효할 때 변경하지 않는다. */
  tentative?: boolean;
}

export interface SurveyorRecommendation {
  targetId: number;
  date: string | null;
  responsible: SurveyUser | null;
  participants: SurveyUser[];
  experiencedReviewer: SurveyUser | null;
  surveyMethod: SurveyMethod;
  preserved: boolean;
}

export interface SurveyorRecommendationInput {
  targets: SurveyorRecommendationTarget[];
  users: SurveyUser[];
  assignments?: TentativeSurveyorAssignment[];
  availability: Availability;
}

interface SurveyorCombination {
  responsible: SurveyUser;
  participants: SurveyUser[];
  reviewer: SurveyUser | null;
}

const targetPriority = (target: SurveyorRecommendationTarget) => target.businessType === "first_measurement"
  ? 0
  : target.businessType === "external_new" ? 1 : 2;

function deterministicTargets(targets: SurveyorRecommendationTarget[]) {
  return [...targets].sort((left, right) =>
    targetPriority(left) - targetPriority(right) ||
    left.measurementDate.localeCompare(right.measurementDate) ||
    (left.createdAt ?? "9999-12-31T23:59:59.999Z").localeCompare(right.createdAt ?? "9999-12-31T23:59:59.999Z") ||
    left.id - right.id,
  );
}

function active(users: SurveyUser[]) {
  return users.filter((user) => user.active !== false).sort((left, right) => left.id - right.id);
}

function participantsForTentative(
  assignment: TentativeSurveyorAssignment,
  usersById: Map<number, SurveyUser>,
) {
  const ids = [...new Set([assignment.responsibleUserId, ...assignment.participants])];
  const participants = ids.map((id) => usersById.get(id)).filter((user): user is SurveyUser => Boolean(user));
  const responsible = usersById.get(assignment.responsibleUserId) ?? null;
  const reviewer = assignment.experiencedReviewerId == null ? null : usersById.get(assignment.experiencedReviewerId) ?? null;
  return { participants, responsible, reviewer };
}

function assignmentMethod(assignment: ExistingAssignment): SurveyMethod {
  return assignment.surveyMethod ?? surveyMethodForKind(assignment.kind);
}

function phoneCount(assignments: ExistingAssignment[], userId: number, date: string) {
  return assignments.filter((assignment) =>
    assignmentMethod(assignment) === "phone" && assignment.date === date && assignment.participants.includes(userId),
  ).length;
}

function fieldCount(assignments: ExistingAssignment[], userId: number, date: string) {
  return assignments.filter((assignment) =>
    assignmentMethod(assignment) === "field" && assignment.date === date && assignment.participants.includes(userId),
  ).length;
}

function validParticipants(participants: SurveyUser[], date: string, availability: Availability) {
  return participants.length > 0 && participants.every((user) => user.active !== false && !availability.isBlocked(user.id, date));
}

function fitsCapacity(kind: BusinessKind, participants: SurveyUser[], date: string, assignments: ExistingAssignment[]) {
  return participants.every((user) => kind === "existing"
    ? phoneCount(assignments, user.id, date) < 3
    : fieldCount(assignments, user.id, date) < 2,
  );
}

function asAssignment(target: SurveyorRecommendationTarget, recommendation: SurveyorRecommendation): ExistingAssignment {
  return {
    targetId: target.id,
    businessCode: String(target.id),
    kind: target.kind,
    date: recommendation.date!,
    participants: recommendation.participants.map((user) => user.id),
    responsibleUserId: recommendation.responsible!.id,
    experiencedReviewerId: recommendation.experiencedReviewer?.id ?? null,
    surveyMethod: recommendation.surveyMethod,
    coordinate: null,
    region: null,
  };
}

function candidateCombinations(target: SurveyorRecommendationTarget, users: SurveyUser[]): SurveyorCombination[] {
  if (target.kind === "existing") {
    // 기존업체 유선은 경력 동행이 아닌 담당자 1명의 개인 용량만 확인한다.
    return users.map((responsible) => ({ responsible, participants: [responsible], reviewer: null }));
  }

  const experienced = users.filter((user) => user.experienced);
  return users.flatMap<SurveyorCombination>((responsible) => responsible.experienced
    ? [{ responsible, participants: [responsible], reviewer: null }]
    : experienced.filter((reviewer) => reviewer.id !== responsible.id).map((reviewer) => ({
      responsible, participants: [responsible, reviewer], reviewer,
    })),
  );
}

function compareCandidates(
  assignments: ExistingAssignment[],
  date: string,
  left: { responsible: SurveyUser; participants: SurveyUser[] },
  right: { responsible: SurveyUser; participants: SurveyUser[] },
  kind: BusinessKind,
) {
  const load = (candidate: { participants: SurveyUser[] }) => candidate.participants.reduce(
    (sum, user) => sum + (kind === "existing" ? phoneCount(assignments, user.id, date) : fieldCount(assignments, user.id, date)), 0,
  );
  return load(left) - load(right) ||
    left.participants.length - right.participants.length ||
    left.responsible.id - right.responsible.id ||
    left.participants.map((user) => user.id).join(",").localeCompare(right.participants.map((user) => user.id).join(","));
}

/**
 * DB/경로 호출 없이 후보일 × 조사자 조합만 탐색한다.
 * 이미 유효한 가확정은 먼저 reserve하여 불필요한 재추천을 피하고, 나머지는 날짜 정책 순서와
 * 개인별 현재 용량, 사용자 ID 순으로 안정적으로 선택한다.
 */
export function recommendSurveyors(input: SurveyorRecommendationInput): SurveyorRecommendation[] {
  const users = active(input.users);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const targets = deterministicTargets(input.targets);
  const targetById = new Map(targets.map((target) => [target.id, target]));
  const tentativeByTarget = new Map((input.assignments ?? [])
    .filter((assignment) => assignment.tentative)
    .map((assignment) => [assignment.targetId, assignment]));
  const occupied: ExistingAssignment[] = (input.assignments ?? []).filter((assignment) => !assignment.tentative);
  const results: SurveyorRecommendation[] = [];

  for (const target of targets) {
    const tentative = tentativeByTarget.get(target.id);
    if (tentative && target.candidateDates.includes(tentative.date)) {
      const { participants, responsible, reviewer } = participantsForTentative(tentative, usersById);
      if (responsible && validParticipants(participants, tentative.date, input.availability) &&
        fitsCapacity(target.kind, participants, tentative.date, occupied)) {
        const preserved = {
          targetId: target.id, date: tentative.date, responsible, participants, experiencedReviewer: reviewer,
          surveyMethod: assignmentMethod(tentative), preserved: true,
        } satisfies SurveyorRecommendation;
        results.push(preserved);
        occupied.push(asAssignment(target, preserved));
        continue;
      }
    }

    let selected: SurveyorRecommendation | null = null;
    for (const date of target.candidateDates) {
      const choices = candidateCombinations(target, users)
        .filter((choice) => validParticipants(choice.participants, date, input.availability))
        .filter((choice) => fitsCapacity(target.kind, choice.participants, date, occupied))
        .sort((left, right) => compareCandidates(occupied, date, left, right, target.kind));
      const choice = choices[0];
      if (!choice) continue;
      selected = {
        targetId: target.id, date, responsible: choice.responsible, participants: choice.participants,
        experiencedReviewer: choice.reviewer, surveyMethod: surveyMethodForKind(target.kind), preserved: false,
      };
      break;
    }
    if (selected) occupied.push(asAssignment(target, selected));
    results.push(selected ?? {
      targetId: target.id, date: null, responsible: null, participants: [], experiencedReviewer: null,
      surveyMethod: surveyMethodForKind(target.kind), preserved: false,
    });
  }

  // 입력 순서가 아닌 대상 ID 기준으로 반환해 service의 원래 대상 정렬을 보존한다.
  return results.sort((left, right) => {
    const leftTarget = targetById.get(left.targetId)!;
    const rightTarget = targetById.get(right.targetId)!;
    return leftTarget.measurementDate.localeCompare(rightTarget.measurementDate) || left.targetId - right.targetId;
  });
}
