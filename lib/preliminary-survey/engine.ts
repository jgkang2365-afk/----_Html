import {
  currentDateOnly,
  futureWorkingDaysBefore,
  getHolidayCoverageWarning,
} from "./calendar";
import {
  RecommendationResult,
  RecommendationUser,
  ScheduleBlock,
  ScheduleConflict,
  WorkloadSummary,
  PreliminarySurveyRuleType,
} from "./types";

type RecommendationSlot = "default" | "earlier" | "later";

interface EngineInput {
  ruleType?: PreliminarySurveyRuleType;
  measurementDate: string;
  targetRegion: string;
  responsible: RecommendationUser;
  supportCandidates: RecommendationUser[];
  blocks: ScheduleBlock[];
  schedules: ScheduleConflict[];
  workloads: Map<number, WorkloadSummary>;
  today?: string;
}

interface Combination {
  slot: RecommendationSlot;
  date: string;
  experienced: RecommendationUser | null;
  score: number;
  warnings: string[];
  distance: number;
}

function isBlocked(blocks: ScheduleBlock[], userId: number, date: string): boolean {
  return blocks.some(
    (block) =>
      block.user_id === userId && block.start_date <= date && block.end_date >= date,
  );
}

function scheduleFor(
  schedules: ScheduleConflict[],
  userId: number,
  date: string,
): ScheduleConflict {
  return (
    schedules
      .filter((item) => item.userId === userId && item.date === date)
      .sort((a, b) => {
        const rank = { different_region: 3, unknown_region: 2, same_region: 1, none: 0 };
        return rank[b.kind] - rank[a.kind];
      })[0] || { userId, date, kind: "none" }
  );
}

function warningsFor(conflicts: ScheduleConflict[], date: string): string[] {
  const warnings: string[] = [];
  if (conflicts.some((item) => item.kind === "same_region")) {
    warnings.push("SAME_REGION_SCHEDULE_TIME_CHECK_REQUIRED");
  }
  if (conflicts.some((item) => item.kind === "unknown_region")) {
    warnings.push("UNKNOWN_REGION_SCHEDULE_CHECK_REQUIRED");
  }
  const holidayWarning = getHolidayCoverageWarning(date);
  if (holidayWarning) warnings.push(holidayWarning);
  return warnings;
}

function slotForDistance(distance: number): RecommendationSlot {
  if (distance >= 20 && distance <= 30) return "default";
  if (distance > 30) return "earlier";
  return "later";
}

function slotEmptyReason(
  slotDates: Array<{ date: string; workingDaysBefore: number }>,
  responsibleAvailable: boolean,
  requiresSupport: boolean,
): string {
  if (slotDates.length === 0) return "NO_FUTURE_WORKING_DAY_IN_RANGE";
  if (!responsibleAvailable) return "RESPONSIBLE_SCHEDULE_CONFLICT";
  if (requiresSupport) return "NO_AVAILABLE_EXPERIENCED_USER";
  return "NO_AVAILABLE_DATE";
}

export function recommendPreliminarySurvey(input: EngineInput): RecommendationResult {
  const isExisting = input.ruleType === "existing";
  const today = input.today || currentDateOnly();
  const dates = futureWorkingDaysBefore(input.measurementDate, today);
  const base = {
    responsibleUserId: input.responsible.id,
    responsibleUserName: input.responsible.name,
  };

  if (!input.responsible.is_active || input.responsible.job !== "측정") {
    return {
      ...base,
      status: "pending",
      reason: "RESPONSIBLE_USER_UNAVAILABLE",
      recommendedDate: null,
      experiencedUserId: null,
      experiencedUserName: null,
      visitMode: null,
      score: null,
      warnings: [],
      alternatives: [],
      reasonDetails: {},
    };
  }

  const eligibleSupporters = isExisting || input.responsible.is_preliminary_survey_experienced
    ? []
    : input.supportCandidates
        .filter(
          (user) =>
            user.is_active &&
            user.job === "측정" &&
            user.is_preliminary_survey_experienced &&
            user.is_preliminary_survey_support_assignable &&
            user.id !== input.responsible.id,
        )
        .sort((a, b) => a.id - b.id);
  const supporters: Array<RecommendationUser | null> =
    isExisting || input.responsible.is_preliminary_survey_experienced
      ? [null]
      : eligibleSupporters;
  const combinations: Combination[] = [];

  for (const candidate of dates) {
    for (const experienced of supporters) {
      const participantIds = [input.responsible.id, experienced?.id].filter(
        (value): value is number => value !== undefined,
      );
      if (participantIds.some((id) => isBlocked(input.blocks, id, candidate.date))) continue;
      const conflicts = participantIds.map((id) =>
        scheduleFor(input.schedules, id, candidate.date),
      );
      if (conflicts.some((item) => item.kind === "different_region")) continue;

      const regionRank = conflicts.reduce((rank, item) => {
        if (item.kind === "unknown_region") return Math.max(rank, 2);
        if (item.kind === "none") return Math.max(rank, 1);
        return rank; // 같은 지역 일정은 이동 효율을 위해 최우선으로 활용한다.
      }, 0);
      const workload = experienced
        ? input.workloads.get(experienced.id) || { halfYear: 0, recent30Days: 0, byDate: {} }
        : { halfYear: 0, recent30Days: 0, byDate: {} };
      // 일정 충돌 없음 → 지역 효율 → 측정일까지의 여유 → 업무량 균형 순서의 사전식 점수.
      const score =
        regionRank * 1_000_000_000_000 +
        (800 - candidate.workingDaysBefore) * 1_000_000_000 +
        workload.halfYear * 1_000_000 +
        workload.recent30Days * 1_000 +
        (workload.byDate[candidate.date] || 0);

      combinations.push({
        slot: slotForDistance(candidate.workingDaysBefore),
        date: candidate.date,
        experienced,
        score,
        warnings: [...new Set(warningsFor(conflicts, candidate.date))],
        distance: candidate.workingDaysBefore,
      });
    }
  }

  const slotOrder: RecommendationSlot[] = ["default", "earlier", "later"];
  const bestBySlot = new Map<RecommendationSlot, Combination>();
  for (const slot of slotOrder) {
    const best = combinations
      .filter((item) => item.slot === slot)
      .sort(
        (a, b) =>
          a.score - b.score ||
          (a.experienced?.id || 0) - (b.experienced?.id || 0) ||
          a.date.localeCompare(b.date),
      )[0];
    if (best) bestBySlot.set(slot, best);
  }

  const requiresSupport = !isExisting && !input.responsible.is_preliminary_survey_experienced;
  const recommendationSlots = slotOrder.map((slot) => {
    const slotDates = dates.filter((candidate) => slotForDistance(candidate.workingDaysBefore) === slot);
    const responsibleAvailable = slotDates.some((candidate) => {
      if (isBlocked(input.blocks, input.responsible.id, candidate.date)) return false;
      return scheduleFor(input.schedules, input.responsible.id, candidate.date).kind !== "different_region";
    });
    const best = bestBySlot.get(slot);
    return best
      ? {
          slot,
          date: best.date,
          experiencedUserId: best.experienced?.id || null,
          experiencedUserName: best.experienced?.name || null,
          score: best.score,
          warnings: best.warnings,
          workingDaysBefore: best.distance,
          emptyReason: null,
        }
      : {
          slot,
          date: null,
          experiencedUserId: null,
          experiencedUserName: null,
          score: null,
          warnings: [],
          workingDaysBefore: null,
          emptyReason: slotEmptyReason(slotDates, responsibleAvailable, requiresSupport),
        };
  });
  const selected = slotOrder.map((slot) => bestBySlot.get(slot)).find(Boolean);

  if (!selected) {
    const responsibleHasAnyDate = dates.some((candidate) => {
      if (isBlocked(input.blocks, input.responsible.id, candidate.date)) return false;
      return scheduleFor(input.schedules, input.responsible.id, candidate.date).kind !== "different_region";
    });
    return {
      ...base,
      status: "pending",
      reason: requiresSupport && responsibleHasAnyDate
        ? "NO_AVAILABLE_EXPERIENCED_USER"
        : "NO_AVAILABLE_DATE",
      recommendedDate: null,
      experiencedUserId: null,
      experiencedUserName: null,
      visitMode: null,
      score: null,
      warnings: [],
      alternatives: [],
      reasonDetails: {
        today,
        searchedWorkingDays: dates.length,
        manualAdjustmentRequired: true,
        recommendationSlots,
      },
    };
  }

  return {
    ...base,
    status: "recommended",
    reason: isExisting
      ? "EXISTING_VISIT_RECOMMENDATION_CREATED"
      : "RECOMMENDATION_CREATED",
    recommendedDate: selected.date,
    experiencedUserId: selected.experienced?.id || null,
    experiencedUserName: selected.experienced?.name || null,
    visitMode: isExisting
      ? "existing_field_visit"
      : selected.experienced
        ? "joint_field_visit"
        : "experienced_solo_visit",
    score: selected.score,
    warnings: selected.warnings,
    alternatives: slotOrder
      .map((slot) => bestBySlot.get(slot))
      .filter((item): item is Combination => Boolean(item && item !== selected))
      .map((item) => ({
        slot: item.slot,
        date: item.date,
        experiencedUserId: item.experienced?.id || null,
        experiencedUserName: item.experienced?.name || null,
        score: item.score,
        warnings: item.warnings,
      })),
    reasonDetails: {
      today,
      preferredWorkingDayRange: { from: 20, to: 30 },
      selectedSlot: selected.slot,
      selectedWorkingDaysBefore: selected.distance,
      targetRegion: input.targetRegion,
      phoneSurveyAllowed: isExisting,
      recommendationAssumption: "field_visit",
      recommendationSlots,
    },
  };
}
