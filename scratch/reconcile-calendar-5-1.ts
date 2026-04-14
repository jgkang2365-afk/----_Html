import { createClient } from "@supabase/supabase-js";
import { listEvents, deleteSurveyEvent } from "../lib/google/calendar";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function reconcile() {
  const targetDate = "2026-05-01";
  console.log(`[Reconcile] Checking for residues on ${targetDate}...`);

  // 1. Google Calendar에서 해당 날짜 이벤트 조회
  const timeMin = new Date(`${targetDate}T00:00:00Z`).toISOString();
  const timeMax = new Date(`${targetDate}T23:59:59Z`).toISOString();
  const events = await listEvents(timeMin, timeMax);

  console.log(`[Reconcile] Found ${events.length} events on Google Calendar for ${targetDate}`);

  // 2. Supabase에서 해당 날짜 예비조사 조회
  const { data: surveys, error } = await supabase
    .from("preliminary_survey")
    .select("id, business_name, google_event_id")
    .eq("measurement_date", targetDate);

  if (error) {
    console.error("[Reconcile] Supabase error:", error);
    return;
  }

  const dbEventIds = new Set(surveys?.map(s => s.google_event_id).filter(Boolean) || []);
  console.log(`[Reconcile] Found ${surveys?.length || 0} survey records in DB for ${targetDate}`);

  // 3. 비교 및 삭제
  for (const event of events) {
    const eventId = event.id;
    if (!eventId) continue;

    // 수동으로 만든 이벤트(예: 노동절) 등은 제외해야 함
    // 시스템에서 만든 이벤트는 요약 형태가 "[측정자] 업체명" 또는 설명에 사업장 정보가 있음
    const isSystemEvent = event.description?.includes("사업장:") || event.summary?.startsWith("[");
    
    if (isSystemEvent && !dbEventIds.has(eventId)) {
      console.log(`[Reconcile] Found residue event: "${event.summary}" (${eventId}). Deleting...`);
      const success = await deleteSurveyEvent(eventId);
      if (success) {
        console.log(`[Reconcile] Successfully deleted residue event: ${event.summary}`);
      } else {
        console.error(`[Reconcile] Failed to delete event: ${event.summary}`);
      }
    } else if (!isSystemEvent) {
      console.log(`[Reconcile] Skipping NON-system event: "${event.summary}"`);
    } else {
      console.log(`[Reconcile] Event is valid (exists in DB): "${event.summary}"`);
    }
  }

  console.log("[Reconcile] Done.");
}

reconcile();
