import { createClient } from "@supabase/supabase-js";
import { listEvents } from "../lib/google/calendar";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkIntegrity() {
  console.log("=== [Self-Check] Calendar Integrity Audit ===");

  // 1. 구글 캘린더 이벤트 전체 목록 조회 (향후 1개월 및 과거 1개월 범위)
  const now = new Date();
  const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const timeMax = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  
  console.log(`[Audit] Fetching events from ${timeMin} to ${timeMax}...`);
  const calendarEvents = await listEvents(timeMin, timeMax);
  console.log(`[Audit] Total events in calendar: ${calendarEvents.length}`);

  // 2. Supabase의 예비조사 레코드 전체 조회 (연동된 것들)
  const { data: surveys, error } = await supabase
    .from("preliminary_survey")
    .select("id, business_name, measurement_date, google_event_id")
    .not("google_event_id", "is", null);

  if (error) {
    console.error("[Audit] Supabase fetch error:", error);
    return;
  }

  const dbIds = new Set(surveys.map(s => s.google_event_id));
  const idToSurvey = new Map(surveys.map(s => [s.google_event_id, s]));

  console.log(`[Audit] Total synchronized records in DB: ${surveys.length}`);

  // 3. 정합성 검사
  const residues = [];
  const missingInCal = [];

  // A. 캘린더에는 있지만 DB에는 없는 이벤트 (찌꺼기)
  for (const event of calendarEvents) {
    const isSystemEvent = event.description?.includes("사업장:") || event.summary?.startsWith("[");
    if (isSystemEvent && !dbIds.has(event.id)) {
      residues.push({
        id: event.id,
        summary: event.summary,
        date: event.start?.date || event.start?.dateTime
      });
    }
  }

  // B. DB에는 ID가 있지만 캘린더에는 실제 이벤트가 없는 경우 (유실)
  const calIds = new Set(calendarEvents.map(e => e.id));
  for (const survey of surveys) {
    if (!calIds.has(survey.google_event_id)) {
      missingInCal.push(survey);
    }
  }

  // 4. 리포트 출력
  console.log("\n--- Integrity Report ---");
  console.log(`- Residue Events (Orphans): ${residues.length}`);
  residues.forEach(r => console.log(`  [Orphan] ${r.date}: ${r.summary} (${r.id})`));

  console.log(`- Missing in Calendar (Desync): ${missingInCal.length}`);
  missingInCal.forEach(m => console.log(`  [Missing] ${m.measurement_date}: ${m.business_name} (ID: ${m.id})`));

  console.log("\n[Audit] Completed.");
  return { residues, missingInCal };
}

checkIntegrity();
