import {
  getHolidayCoverageWarning,
  workingDaysBefore,
} from "./calendar";
import {
  RecommendationResult,
  RecommendationUser,
  ScheduleBlock,
  ScheduleConflict,
  WorkloadSummary,
  PreliminarySurveyRuleType,
  CalendarRecommendationSignal,
} from "./types";

interface EngineInput {
  ruleType?: PreliminarySurveyRuleType;
  measurementDate: string;
  targetRegion: string;
  responsible: RecommendationUser;
  supportCandidates: RecommendationUser[];
  blocks: ScheduleBlock[];
  schedules: ScheduleConflict[];
  workloads: Map<number, WorkloadSummary>;
  calendarSignals?: CalendarRecommendationSignal[];
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

function warningsFor(conflicts: ScheduleConflict[]): string[] {
  const warnings: string[] = [];
  if (conflicts.some((item) => item.kind === "same_region")) {
    warnings.push("SAME_REGION_SCHEDULE_TIME_CHECK_REQUIRED");
  }
  if (conflicts.some((item) => item.kind === "unknown_region")) {
    warnings.push("UNKNOWN_REGION_SCHEDULE_CHECK_REQUIRED");
  }
  return warnings;
}

export function recommendPreliminarySurvey(input: EngineInput): RecommendationResult {
  const isExisting = input.ruleType === "existing";
  const dates = workingDaysBefore(input.measurementDate, 30);
  const holidayWarning = getHolidayCoverageWarning(input.measurementDate);
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

  const combinations: Array<{
    date: string;
    experienced: RecommendationUser | null;
    score: number;
    warnings: string[];
    distance: number;
  }> = [];
  const supporters = isExisting || input.responsible.is_preliminary_survey_experienced
    ? [null]
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

  for (const candidate of dates) {
    for (const experienced of supporters) {
      const participantIds = [input.responsible.id, experienced?.id].filter(
        (value): value is number => value !== undefined,
      );
      if (participantIds.some((id) => isBlocked(input.blocks, id, candidate.date))) continue;
      if (
        input.calendarSignals?.some(
          (signal) =>
            signal.date === candidate.date &&
            signal.kind === "occupied" &&
            participantIds.includes(signal.userId),
        )
      ) continue;

      const conflicts = participantIds.map((id) =>
        scheduleFor(input.schedules, id, candidate.date),
      );
      if (conflicts.some((item) => item.kind === "different_region")) continue;

      const warnings = warningsFor(conflicts);
      if (holidayWarning) warnings.push(holidayWarning);
      const workload = experienced
        ? input.workloads.get(experienced.id) || {
            halfYear: 0,
            recent30Days: 0,
            byDate: {},
          }
        : { halfYear: 0, recent30Days: 0, byDate: {} };
      const schedulePenalty = conflicts.reduce((sum, item) => {
        if (item.kind === "same_region") return sum + 20;
        if (item.kind === "unknown_region") return sum + 60;
        return sum;
      }, 0);
      const existingSchedulePriority = isExisting
        ? conflicts.reduce((sum, item) => {
            if (item.kind === "same_region") return sum + 1_000_000;
            if (item.kind === "unknown_region") return sum + 2_000_000;
            return sum;
          }, 0)
        : 0;
      const score =
        (input.calendarSignals?.some(
          (signal) =>
            signal.date === candidate.date &&
            signal.kind === "preferred" &&
            participantIds.includes(signal.userId),
        ) ? -5_000_000 : 0) +
        existingSchedulePriority +
        Math.abs(candidate.workingDaysBefore - 5) * 10_000 +
        schedulePenalty * 100 +
        workload.halfYear * 20 +
        workload.recent30Days * 5 +
        (workload.byDate[candidate.date] || 0) * 2 +
        candidate.workingDaysBefore;

      combinations.push({
        date: candidate.date,
        experienced,
        score,
        warnings: [...new Set(warnings)],
        distance: candidate.workingDaysBefore,
      });
    }
  }

  combinations.sort(
    (a, b) =>
      a.score - b.score ||
      (a.experienced?.id || 0) - (b.experienced?.id || 0) ||
      a.date.localeCompare(b.date),
  );

  const best = combinations[0];
  if (!best) {
    const noSupport =
      !isExisting &&
      !input.responsible.is_preliminary_survey_experienced && supporters.length === 0;
    return {
      ...base,
      status: "pending",
      reason: noSupport ? "NO_AVAILABLE_EXPERIENCED_USER" : "NO_AVAILABLE_DATE",
      recommendedDate: null,
      experiencedUserId: null,
      experiencedUserName: null,
      visitMode: null,
      score: null,
      warnings: holidayWarning ? [holidayWarning] : [],
      alternatives: [],
      reasonDetails: { searchedWorkingDays: dates.length },
    };
  }

  return {
    ...base,
    status: "recommended",
    reason: isExisting
      ? "EXISTING_VISIT_RECOMMENDATION_CREATED"
      : "RECOMMENDATION_CREATED",
    recommendedDate: best.date,
    experiencedUserId: best.experienced?.id || null,
    experiencedUserName: best.experienced?.name || null,
    visitMode: isExisting
      ? "existing_field_visit"
      : best.experienced
        ? "joint_field_visit"
        : "experienced_solo_visit",
    score: best.score,
    warnings: best.warnings,
    alternatives: combinations.slice(1, 4).map((item) => ({
      date: item.date,
      experiencedUserId: item.experienced?.id || null,
      experiencedUserName: item.experienced?.name || null,
      score: item.score,
      warnings: item.warnings,
    })),
    reasonDetails: {
      preferredWorkingDaysBefore: 5,
      selectedWorkingDaysBefore: best.distance,
      targetRegion: input.targetRegion,
      phoneSurveyAllowed: isExisting,
      recommendationAssumption: isExisting ? "field_visit" : "field_visit_required",
      calendarPreferenceApplied: Boolean(
        input.calendarSignals?.some(
          (signal) =>
            signal.date === best.date &&
            signal.kind === "preferred" &&
            [input.responsible.id, best.experienced?.id].includes(signal.userId),
        ),
      ),
      calendarSignalSnapshot: (input.calendarSignals || []).filter(
        (signal) => signal.date === best.date,
      ),
    },
  };
}
