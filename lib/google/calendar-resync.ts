import {
  measurementDayFormsFrom,
  normalizeMeasurementCollaborators,
} from "@/lib/business/measurement-day-form";

export interface CalendarResyncTarget {
  daily_staff?: unknown;
  measurement_date?: string | null;
  measurer_id?: number | null;
  collaborators?: unknown;
}

export interface CalendarResyncUser {
  id: number;
  name: string;
}

export interface CalendarSurveyProjection {
  id: number;
  measurement_date: string | null;
  report_writer: string | null;
  actual_measurer: string | null;
  google_event_id: string | null;
}

export interface ExpectedCalendarDay {
  date: string;
  reportWriter: string | null;
  participants: string[];
}

export interface CalendarProjectionValidation {
  valid: boolean;
  message?: string;
  details?: {
    expectedDates: string[];
    surveyDates: string[];
  };
}

const normalizeName = (value: unknown): string | null => {
  const normalized = String(value ?? "").trim();
  return normalized || null;
};

const comparableNames = (value: unknown): string[] =>
  normalizeMeasurementCollaborators(value).sort((left, right) => left.localeCompare(right, "ko"));

export function buildExpectedCalendarDays(
  target: CalendarResyncTarget,
  users: CalendarResyncUser[],
): ExpectedCalendarDay[] {
  const userNames = new Map(users.map((user) => [Number(user.id), String(user.name).trim()]));

  return measurementDayFormsFrom({
    dailyStaff: target.daily_staff,
    measurementDate: target.measurement_date,
    measurerId: target.measurer_id,
    collaborators: target.collaborators,
  })
    .filter((day) => Boolean(day.date.trim()))
    .map((day) => ({
      date: day.date.trim(),
      reportWriter: day.measurerId == null ? null : normalizeName(userNames.get(day.measurerId)),
      participants: comparableNames(day.collaborators),
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function validateCalendarProjection(
  expectedDays: ExpectedCalendarDay[],
  surveys: CalendarSurveyProjection[],
): CalendarProjectionValidation {
  const expectedDates = expectedDays.map((day) => day.date).sort();
  const surveyDates = surveys
    .map((survey) => String(survey.measurement_date || "").trim())
    .filter(Boolean)
    .sort();

  if (
    expectedDates.length !== surveyDates.length ||
    expectedDates.some((date, index) => surveyDates[index] !== date)
  ) {
    return {
      valid: false,
      message: "측정대상사업장과 캘린더 원천 예비조사의 측정일이 일치하지 않습니다.",
      details: { expectedDates, surveyDates },
    };
  }

  const surveysByDate = new Map(
    surveys.map((survey) => [String(survey.measurement_date || "").trim(), survey]),
  );

  for (const expected of expectedDays) {
    const survey = surveysByDate.get(expected.date);
    if (!survey) {
      return {
        valid: false,
        message: `${expected.date} 캘린더 원천 예비조사 행을 찾을 수 없습니다.`,
        details: { expectedDates, surveyDates },
      };
    }

    const actualParticipants = comparableNames(survey.actual_measurer);
    if (
      expected.participants.length !== actualParticipants.length ||
      expected.participants.some((name, index) => actualParticipants[index] !== name)
    ) {
      return {
        valid: false,
        message: `${expected.date} 측정참여자 값이 측정대상사업장과 예비조사 원천 사이에서 다릅니다.`,
        details: { expectedDates, surveyDates },
      };
    }

    if (normalizeName(survey.report_writer) !== expected.reportWriter) {
      return {
        valid: false,
        message: `${expected.date} 보고서 담당자 값이 측정대상사업장과 예비조사 원천 사이에서 다릅니다.`,
        details: { expectedDates, surveyDates },
      };
    }
  }

  return { valid: true };
}

export type CalendarResyncAction = "updated" | "created" | "recreated";

export function summarizeCalendarResyncActions(
  before: CalendarSurveyProjection[],
  after: CalendarSurveyProjection[],
): Array<{ date: string; eventId: string; action: CalendarResyncAction }> {
  const beforeById = new Map(before.map((survey) => [survey.id, survey]));

  return after
    .filter((survey) => Boolean(survey.measurement_date && survey.google_event_id))
    .map((survey) => {
      const previous = beforeById.get(survey.id);
      const previousEventId = previous?.google_event_id || null;
      const nextEventId = survey.google_event_id!;
      const action: CalendarResyncAction = previousEventId == null
        ? "created"
        : previousEventId === nextEventId
          ? "updated"
          : "recreated";

      return {
        date: String(survey.measurement_date),
        eventId: nextEventId,
        action,
      };
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}
