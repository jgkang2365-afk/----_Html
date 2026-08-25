import type { SupabaseClient } from "@supabase/supabase-js";
import type { SurveyUser } from "./types";

type Client = SupabaseClient<any, "public", any>;

export interface MeasurementTargetScheduleRow {
  measurement_date: string | null;
  measurement_end_date?: string | null;
  daily_staff: unknown;
  collaborators: unknown;
}

export interface LegacyMeasurementScheduleRow {
  measurement_date: string | null;
  actual_measurer: unknown;
}

interface DailyStaffEntry {
  date?: unknown;
  main_measurer_id?: unknown;
  helper_ids?: unknown;
  // 기존 collaborators는 실제 측정자 목록이다. measurer_id는 보고서 담당자라 사용하지 않는다.
  measurer_id?: unknown;
  collaborators?: unknown;
}

function values(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function participantIds(value: unknown, userIdByName: Map<string, number>): number[] {
  return values(value).flatMap((item) => {
    const numeric = Number(item);
    if (Number.isInteger(numeric)) return [numeric];
    const id = userIdByName.get(String(item).trim());
    return id == null ? [] : [id];
  });
}

/**
 * 실제 측정 참가자만 날짜별 unavailable로 만든다.
 * daily_staff가 있는 다일 사업장은 정확히 같은 날짜 entry만 사용하고,
 * report_writer/measurer_id(보고서 담당자)는 unavailable 판정에 사용하지 않는다.
 */
export function actualMeasurementBlockedKeys(input: {
  dates: string[];
  users: Array<Pick<SurveyUser, "id" | "name">>;
  targets: MeasurementTargetScheduleRow[];
  legacySchedules: LegacyMeasurementScheduleRow[];
}) {
  const dates = new Set(input.dates);
  const blockedKeys = new Set<string>();
  const userIdByName = new Map(input.users.map((user) => [user.name, user.id]));
  const add = (date: string, source: unknown) => {
    for (const userId of participantIds(source, userIdByName)) blockedKeys.add(`${userId}:${date}`);
  };

  for (const target of input.targets) {
    const dailyStaff = Array.isArray(target.daily_staff) ? target.daily_staff as DailyStaffEntry[] : [];
    if (dailyStaff.length > 0) {
      for (const entry of dailyStaff) {
        const date = String(entry?.date ?? "");
        if (!dates.has(date)) continue;
        add(date, entry.main_measurer_id);
        add(date, entry.helper_ids ?? entry.collaborators);
      }
      continue;
    }
    const date = String(target.measurement_date ?? "");
    if (dates.has(date)) add(date, target.collaborators);
  }

  // legacy에서는 실제 측정자 의미가 명확한 actual_measurer만 사용한다.
  for (const schedule of input.legacySchedules) {
    const date = String(schedule.measurement_date ?? "");
    if (dates.has(date)) add(date, schedule.actual_measurer);
  }
  return blockedKeys;
}

export async function loadActualMeasurementBlockedKeys(
  supabase: Client,
  datesInput: string[],
  users: Array<Pick<SurveyUser, "id" | "name">>,
) {
  const dates = [...new Set(datesInput)].sort();
  if (!dates.length) return new Set<string>();
  // 연말·연초를 넘는 다일 측정도 시작일 기준 year 필터에서 빠지지 않게 직전 연도를 함께 조회한다.
  const years = [...new Set(dates.flatMap((date) => {
    const year = Number(date.slice(0, 4));
    return Number.isInteger(year) ? [year - 1, year] : [];
  }))];
  let targetQuery = supabase.from("measurement_target_business").select(
    "measurement_date, measurement_end_date, daily_staff, collaborators",
  ).lte("measurement_date", dates.at(-1));
  if (years.length) targetQuery = targetQuery.in("year", years);

  const [{ data: targets, error: targetError }, { data: legacySchedules, error: legacyError }] = await Promise.all([
    targetQuery,
    supabase.from("preliminary_survey").select("measurement_date, actual_measurer").in("measurement_date", dates),
  ]);
  if (targetError || legacyError) {
    throw new Error(`V2_MEASUREMENT_SCHEDULE_QUERY_FAILED:${targetError?.message ?? legacyError?.message}`);
  }
  return actualMeasurementBlockedKeys({
    dates,
    users,
    targets: (targets ?? []) as MeasurementTargetScheduleRow[],
    legacySchedules: (legacySchedules ?? []) as LegacyMeasurementScheduleRow[],
  });
}
