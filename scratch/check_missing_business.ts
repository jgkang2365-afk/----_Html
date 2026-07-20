import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkCreatedAt() {
  const targetCodes = ["H0014", "H0015", "H0017", "H0018"];
  console.log("=== H0014, H0015, H0017, H0018 생성 일시 조회 ===");
  
  const { data: targets, error } = await supabase
    .from("measurement_target_business")
    .select("code, created_at, updated_at")
    .in("code", targetCodes);

  if (error) {
    console.error("오류:", error.message);
  } else {
    console.table(targets);
  }
}

checkCreatedAt();
