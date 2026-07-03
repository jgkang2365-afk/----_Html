import { createServerClient } from "../lib/db/supabase";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function check() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("measurement_target_business")
    .select("id, code, business_name, sync_status, sync_error_message, national_support_status, industrial_accident_number, commencement_number, representative_name")
    .eq("code", "H0394");

  if (error) {
    console.error("DB 조회 오류:", error);
    return;
  }

  console.log("=== DB 조회 결과 (케이케이엘 유한회사) ===");
  console.log(JSON.stringify(data, null, 2));
}

check().catch(console.error);
