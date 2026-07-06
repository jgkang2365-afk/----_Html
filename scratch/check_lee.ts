import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  console.log("=== business_info 테이블 스키마 조회 ===");
  
  // 임의의 데이터를 하나 가져와서 shape 확인
  const { data: info, error } = await supabase
    .from("business_info")
    .select("*")
    .limit(1);

  if (error) {
    console.error(error);
  } else {
    console.log("business_info shape:", Object.keys(info[0] || {}));
  }

  // measurement_business 테이블도 shape 확인
  const { data: mb, error: mbError } = await supabase
    .from("measurement_business")
    .select("*")
    .limit(1);

  if (mbError) {
    console.error(mbError);
  } else {
    console.log("measurement_business shape:", Object.keys(mb[0] || {}));
  }
}

checkSchema();
