import { createClient } from "@supabase/supabase-js";
import { syncBusinessToCalendar } from "../lib/google/sync-service";
import { getSurveyEvent, deleteSurveyEvent } from "../lib/google/calendar";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function runTestHarness() {
  console.log("=== [Harness] Calendar Sync & Successful Null Verification ===");

  const testCode = "TEST_ALFA_123";
  const testYear = 2026;
  const testPeriod = "상반기";

  try {
    // 0. 초기화: 테스트를 위한 더미 데이터 생성
    console.log("[Harness] Step 0: Initializing test data...");
    await supabase.from("preliminary_survey").delete().eq("code", testCode);
    await supabase.from("measurement_target_business").delete().eq("code", testCode);

    // 사업장 정보 생성
    await supabase.from("measurement_target_business").insert({
      code: testCode,
      year: testYear,
      period: testPeriod,
      business_name: "테스트 사업장",
      is_registered: "실시" // 확정 상태여야 캘린더 연동됨
    });
    
    // 1. Scenario A: 신규 일정 생성 및 동기화 확인
    console.log("[Harness] Scenario A: Creating new survey schedule...");
    const { data: survey, error: insertError } = await supabase
      .from("preliminary_survey")
      .insert({
        code: testCode,
        year: testYear,
        period: testPeriod,
        business_name: "테스트 사업장",
        measurement_date: "2026-12-25",
        report_writer: "한기문"
      })
      .select()
      .single();

    if (insertError) throw insertError;

    console.log("[Harness] Triggering sync...");
    await syncBusinessToCalendar(supabase, testCode, testYear, testPeriod);

    // 구글 캘린더 ID 저장되었는지 확인
    const { data: updatedSurvey } = await supabase
      .from("preliminary_survey")
      .select("google_event_id")
      .eq("id", survey.id)
      .single();

    if (updatedSurvey?.google_event_id) {
      console.log(`[PASS] Scenario A: Calendar event created with ID: ${updatedSurvey.google_event_id}`);
    } else {
      throw new Error("Scenario A FAILED: google_event_id not found in DB.");
    }

    const event = await getSurveyEvent(updatedSurvey.google_event_id);
    if (event && event.summary?.includes("테스트 사업장")) {
      console.log(`[PASS] Scenario A: Real Google Calendar event verified.`);
    } else {
      throw new Error("Scenario A FAILED: Event not found on Google Calendar.");
    }

    // 2. Scenario C: 데이터 삭제 시 Successful Null(찌꺼기 제거) 확인
    console.log("\n[Harness] Scenario C: Deleting schedule (Testing Successful Null)...");
    
    // API 레이어 대신 직접 삭제 후 sync 호출 (동기화 엔진의 복구 능력 테스트)
    // 실제 운영에서는 API(DELETE)가 먼저 캘린더를 지웁니다. 
    // 여기서는 동기화 로직이 찌꺼기를 치우는지 테스트하기 위해 고의로 DB만 먼저 지웁니다.
    const googleEventIdToDelete = updatedSurvey.google_event_id;
    await supabase.from("preliminary_survey").delete().eq("id", survey.id);
    
    console.log("[Harness] DB Row deleted. Triggering re-sync...");
    await syncBusinessToCalendar(supabase, testCode, testYear, testPeriod);

    // 캘린더에서 정말 지워졌는지 확인
    const deletedEvent = await getSurveyEvent(googleEventIdToDelete);
    if (!deletedEvent || deletedEvent.status === 'cancelled') {
      console.log("[PASS] Scenario C: Successful Null principle verified. Event removed from calendar.");
    } else {
       throw new Error("Scenario C FAILED: Event still exists in calendar after DB deletion.");
    }

    console.log("\n=== [Harness] ALL SCENARIOS PASSED ===");
  } catch (err: any) {
    console.error(`\n[Harness] FAILED: ${err.message}`);
    process.exit(1);
  } finally {
    // 9. 정리
    await supabase.from("preliminary_survey").delete().eq("code", testCode);
    await supabase.from("measurement_target_business").delete().eq("code", testCode);
  }
}

runTestHarness();
