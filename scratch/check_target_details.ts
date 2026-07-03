import { createAdminClient } from "../lib/supabase/admin";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function checkColumns() {
  const supabase = createAdminClient();

  // 1. DB의 컬럼 정보 상세 조회 (pg_attribute 이용)
  console.log("=== measurement_business 테이블 컬럼 목록 ===");
  const { data: cols, error: colError } = await supabase.rpc("get_columns", { table_name: "measurement_business" });
  
  if (colError) {
    console.log("get_columns rpc가 없으므로 raw query 시도...");
    // rpc가 없을 수 있으므로 직접 sql을 쿼리해 봅니다.
    const { data: rawCols, error: rawError } = await supabase
      .from("measurement_business")
      .select("*")
      .limit(1);
    
    if (rawError) {
      console.error("raw query 실패:", rawError);
    } else if (rawCols && rawCols.length > 0) {
      console.log("존재하는 컬럼명들:", Object.keys(rawCols[0]));
    } else {
      console.log("데이터가 없어서 컬럼을 추출할 수 없습니다.");
    }
  } else {
    console.log("컬럼 목록:", cols);
  }
}

checkColumns().catch(console.error);
