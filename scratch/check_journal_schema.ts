import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function checkSchema() {
  const supabase = createServerClient();
  
  // 1. measurement_journal의 샘플 레코드를 가져와서 어떤 컬럼들이 있는지 확인합니다.
  const { data: journalSample, error: journalErr } = await supabase
    .from("measurement_journal")
    .select("*")
    .limit(1);

  if (journalErr) {
    console.error("measurement_journal 조회 실패:", journalErr);
  } else {
    console.log("=== measurement_journal 컬럼 목록 ===");
    if (journalSample && journalSample.length > 0) {
      console.log(Object.keys(journalSample[0]));
      console.log("샘플 데이터:", journalSample[0]);
    } else {
      console.log("데이터가 없습니다.");
    }
  }

  // 2. measurement_business의 샘플 레코드와 컬럼도 확인합니다.
  const { data: businessSample, error: businessErr } = await supabase
    .from("measurement_business")
    .select("*")
    .limit(1);

  if (businessErr) {
    console.error("measurement_business 조회 실패:", businessErr);
  } else {
    console.log("\n=== measurement_business 컬럼 목록 ===");
    if (businessSample && businessSample.length > 0) {
      console.log(Object.keys(businessSample[0]));
    } else {
      console.log("데이터가 없습니다.");
    }
  }
}

checkSchema().catch(console.error);
