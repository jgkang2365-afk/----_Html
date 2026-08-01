import type { SupabaseClient } from "@supabase/supabase-js";
import { listEvents } from "@/lib/google/calendar";
import { parseDateOnly, workingDaysBefore } from "./calendar";
import type { CalendarRecommendationSignal } from "./types";

type DbClient = SupabaseClient<any, "public", any>;

function normalizeBusinessName(value: string): string {
  return value
    .toLowerCase()
    .replace(/주식회사|\(주\)|㈜/g, "")
    .replace(/[^0-9a-z가-힣]/g, "");
}

export function parsePreliminarySurveyCalendarSignals(
  events: any[],
  users: Array<{ id: number; name: string }>,
  targetBusinessName: string,
): CalendarRecommendationSignal[] {
  const targetKey = normalizeBusinessName(targetBusinessName);
  const signals: CalendarRecommendationSignal[] = [];

  for (const event of events) {
    const summary = String(event?.summary || "").trim();
    // 예비조사 문구가 함께 있더라도 휴가성 일정은 추천 조건에 반영하지 않는다.
    if (/(휴가|연차|반차|휴무)/.test(summary)) continue;
    // 일반 일정은 반영하지 않고 명시적인 예비조사 일정만 사용한다.
    if (!summary.includes("(예비조사)")) continue;
    const bracket = summary.match(/^\[([^\]]+)\]/)?.[1]?.trim() || "";
    const user = users.find(
      (candidate) => bracket === candidate.name || bracket.startsWith(`${candidate.name} `),
    );
    if (!user) continue;
    const date = String(event?.start?.date || event?.start?.dateTime || "").slice(0, 10);
    if (!parseDateOnly(date)) continue;
    const eventBusinessText = summary
      .replace(/^\[[^\]]+\]/, "")
      .split("(예비조사)")[0]
      .trim();
    const eventKey = normalizeBusinessName(eventBusinessText);
    const matchesTarget =
      targetKey.length >= 2 &&
      eventKey.length >= 2 &&
      (eventKey.includes(targetKey) || targetKey.includes(eventKey));
    signals.push({
      userId: user.id,
      date,
      kind: matchesTarget ? "preferred" : "occupied",
      eventId: event?.id ? String(event.id) : null,
      eventUpdatedAt: event?.updated ? String(event.updated) : null,
    });
  }

  return signals;
}

export async function loadPreliminarySurveyCalendarSignals(
  supabase: DbClient,
  targetId: number,
): Promise<{
  signals: CalendarRecommendationSignal[];
  status: "available" | "unavailable" | "not_applicable";
  checkedAt: string;
}> {
  const checkedAt = new Date().toISOString();
  const [{ data: target }, { data: users }] = await Promise.all([
    supabase
      .from("measurement_target_business")
      .select("business_name, measurement_date, daily_staff")
      .eq("id", targetId)
      .maybeSingle(),
    supabase
      .from("users")
      .select("id, name")
      .eq("job", "측정")
      .eq("is_active", true),
  ]);
  const dailyDates = Array.isArray(target?.daily_staff)
    ? target.daily_staff
        .map((entry: any) => String(entry?.date || "").slice(0, 10))
        .filter((date: string) => parseDateOnly(date))
        .sort()
    : [];
  const measurementDate = dailyDates[0] || String(target?.measurement_date || "").slice(0, 10);
  if (!target?.business_name || !parseDateOnly(measurementDate)) {
    return { signals: [], status: "not_applicable", checkedAt };
  }
  const candidates = workingDaysBefore(measurementDate, 30);
  const minDate = candidates[candidates.length - 1]?.date;
  const maxDate = candidates[0]?.date;
  if (!minDate || !maxDate) return { signals: [], status: "not_applicable", checkedAt };

  try {
    const calendarEvents = await Promise.race([
      listEvents(
        `${minDate}T00:00:00+09:00`,
        `${measurementDate}T23:59:59+09:00`,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("GOOGLE_CALENDAR_READ_TIMEOUT")), 6_000),
      ),
    ]);
    return {
      signals: parsePreliminarySurveyCalendarSignals(
        calendarEvents,
        (users || []) as Array<{ id: number; name: string }>,
        target.business_name,
      ).filter((signal) => signal.date >= minDate && signal.date <= maxDate),
      status: "available",
      checkedAt,
    };
  } catch {
    return { signals: [], status: "unavailable", checkedAt };
  }
}
