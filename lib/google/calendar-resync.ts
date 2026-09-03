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

export interface CalendarProjectionUpdate {
  id: number;
  date: string;
  reportWriter: string | null;
  participants: string[];
}

export interface CalendarProjectionInsert {
  date: string;
  reportWriter: string | null;
  participants: string[];
}

export type CalendarProjectionReconciliation =
  | {
      valid: true;
      updates: CalendarProjectionUpdate[];
      inserts: CalendarProjectionInsert[];
    }
  | {
      valid: false;
      message: string;
      details: {
        expectedDates: string[];
        surveyDates: string[];
      };
    };

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

/**
 * Calendar의 업무 원천은 measurement_target_business다.
 * preliminary_survey는 google_event_id와 legacy 연계 행을 보존하기 위한 매핑 계층으로만 사용한다.
 * 날짜/보고서 담당자/측정참여자가 달라도 차단하지 않고 target 값으로 정합화한다.
 * 단, legacy 행이 target 일정 수보다 많은 구조적 중복만 자동 판단이 불가능하므로 중단한다.
 */
export function planCalendarProjectionReconciliation(
  expectedDays: ExpectedCalendarDay[],
  surveys: CalendarSurveyProjection[],
): CalendarProjectionReconciliation {
  const expectedDates = expectedDays.map((day) => day.date).sort();
  const surveyDates = surveys
    .map((survey) => String(survey.measurement_date || "").trim())
    .filter(Boolean)
    .sort();

  if (surveys.length > expectedDays.length) {
    return {
      valid: false,
      message: "측정대상사업장 일정 수보다 legacy 예비조사 연계 행이 더 많아 자동 재동기화할 수 없습니다. 중복 연계 행을 먼저 확인해 주세요.",
      details: { expectedDates, surveyDates },
    };
  }

  const unusedSurveyIds = new Set(surveys.map((survey) => survey.id));
  const surveyByDate = new Map<string, CalendarSurveyProjection>();
  for (const survey of surveys) {
    const date = String(survey.measurement_date || "").trim();
    if (date) surveyByDate.set(date, survey);
  }

  const updates: CalendarProjectionUpdate[] = [];
  const inserts: CalendarProjectionInsert[] = [];
  const unmatchedExpected: ExpectedCalendarDay[] = [];

  // 같은 날짜 행은 ID/google_event_id를 그대로 유지한다.
  for (const expected of expectedDays) {
    const exact = surveyByDate.get(expected.date);
    if (!exact || !unusedSurveyIds.has(exact.id)) {
      unmatchedExpected.push(expected);
      continue;
    }
    unusedSurveyIds.delete(exact.id);
    updates.push({
      id: exact.id,
      date: expected.date,
      reportWriter: expected.reportWriter,
      participants: expected.participants,
    });
  }

  // 날짜가 바뀐 경우에도 기존 legacy 행 ID와 google_event_id를 보존해 새 target 날짜로 이동한다.
  const remainingSurveys = surveys
    .filter((survey) => unusedSurveyIds.has(survey.id))
    .sort((left, right) => left.id - right.id);

  unmatchedExpected.forEach((expected, index) => {
    const reusable = remainingSurveys[index];
    if (reusable) {
      updates.push({
        id: reusable.id,
        date: expected.date,
        reportWriter: expected.reportWriter,
        participants: expected.participants,
      });
      return;
    }
    inserts.push({
      date: expected.date,
      reportWriter: expected.reportWriter,
      participants: expected.participants,
    });
  });

  return {
    valid: true,
    updates: updates.sort((left, right) => left.date.localeCompare(right.date)),
    inserts: inserts.sort((left, right) => left.date.localeCompare(right.date)),
  };
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
