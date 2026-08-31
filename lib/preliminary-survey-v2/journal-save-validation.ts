/** 측정일지 생성 직전 V2 원천이 target Source of Truth와 같은지 좁게 검증한다. */
export interface JournalTargetScheduleSource {
  measurement_date: unknown;
  measurement_end_date?: unknown;
  daily_staff?: unknown;
  measurer_id?: unknown;
  collaborators?: unknown;
}

export interface JournalV2PlanSource {
  id: string;
  source_measurement_date: unknown;
}

export interface JournalV2AssignmentSource {
  plan_id: string;
  measurement_date: unknown;
}

export interface JournalSaveValidationInput {
  target: JournalTargetScheduleSource | null;
  body: Record<string, unknown>;
  plans: JournalV2PlanSource[];
  assignments: JournalV2AssignmentSource[];
}

export interface JournalSaveValidationFailure {
  code: "JOURNAL_TARGET_SCHEDULE_MISMATCH" | "PRELIMINARY_SURVEY_STALE";
  message: string;
}

function dateValues(value: unknown) {
  return String(value ?? "").split(",").map((item) => item.trim())
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item));
}

export function resolveTargetJournalSchedule(target: JournalTargetScheduleSource) {
  const dailyRows = Array.isArray(target.daily_staff) ? target.daily_staff : [];
  const dailyDates = dailyRows.map((row: any) => String(row?.date ?? ""));
  const validDailyDates = dailyDates.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const hasCompleteDailySchedule = dailyRows.length > 0 && validDailyDates.length === dailyRows.length &&
    new Set(validDailyDates).size === validDailyDates.length;
  const dates = [...new Set(hasCompleteDailySchedule ? validDailyDates : dateValues(target.measurement_date))].sort();
  const start = dates[0] ?? null;
  const endFromTarget = String(target.measurement_end_date ?? "").trim();
  const end = hasCompleteDailySchedule
    ? dates.at(-1) ?? null
    : (/^\d{4}-\d{2}-\d{2}$/.test(endFromTarget) ? endFromTarget : dates.at(-1) ?? null);
  return { dates, start, end, hasCompleteDailySchedule };
}

function canonicalJson(value: unknown) {
  return JSON.stringify(value ?? null);
}

/** legacy-only 행은 V2 plan/assignment가 없으므로 이 검증이 저장을 넓게 차단하지 않는다. */
export function validateJournalSavePreliminarySurveySource(input: JournalSaveValidationInput): JournalSaveValidationFailure | null {
  if (!input.target) return null;
  const schedule = resolveTargetJournalSchedule(input.target);
  const bodyStartDate = input.body.measurement_start_date ?? input.body.measurementStartDate;
  const bodyEndDate = input.body.measurement_end_date ?? input.body.measurementEndDate;
  if (bodyStartDate != null && String(bodyStartDate).trim() !== "" && String(bodyStartDate).trim() !== schedule.start) {
    return { code: "JOURNAL_TARGET_SCHEDULE_MISMATCH", message: "측정일지의 측정 시작일이 측정대상사업장 일정과 다릅니다." };
  }
  if (bodyEndDate != null && String(bodyEndDate).trim() !== "" && String(bodyEndDate).trim() !== schedule.end) {
    return { code: "JOURNAL_TARGET_SCHEDULE_MISMATCH", message: "측정일지의 측정 종료일이 측정대상사업장 일정과 다릅니다." };
  }
  if (input.body.daily_staff !== undefined && canonicalJson(input.body.daily_staff) !== canonicalJson(input.target.daily_staff)) {
    return { code: "JOURNAL_TARGET_SCHEDULE_MISMATCH", message: "측정일지 요청의 일자별 측정 인력이 측정대상사업장 원천과 다릅니다." };
  }
  if (input.body.measurer_id !== undefined && Number(input.body.measurer_id) !== Number(input.target.measurer_id)) {
    return { code: "JOURNAL_TARGET_SCHEDULE_MISMATCH", message: "측정일지 요청의 보고서 담당자가 측정대상사업장 원천과 다릅니다." };
  }
  if (input.plans.some((plan) => String(plan.source_measurement_date ?? "") !== String(schedule.start ?? ""))) {
    return { code: "PRELIMINARY_SURVEY_STALE", message: "예비조사 V2 계획의 측정일 원천이 현재 측정대상사업장과 다릅니다." };
  }
  if (input.assignments.some((assignment) => !schedule.dates.includes(String(assignment.measurement_date ?? "")))) {
    return { code: "PRELIMINARY_SURVEY_STALE", message: "측정자(공시료) 배정의 측정일이 현재 측정대상사업장 일정에 없습니다." };
  }
  return null;
}
