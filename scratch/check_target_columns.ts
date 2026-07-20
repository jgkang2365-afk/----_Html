import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "../lib/supabase/server";

async function checkColumns() {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from("measurement_target_business")
      .select("*")
      .limit(1);

    if (error) {
      console.error("데이터 조회 오류:", error);
      return;
    }

    if (data && data.length > 0) {
      console.log("=== business_info 테이블 컬럼 목록 ===");
      console.log(Object.keys(data[0]));
    } else {
      console.log("데이터가 없어서 빈 조회를 수행합니다.");
      const { data: emptyData, error: emptyError } = await supabase
        .from("business_info")
        .select("*")
        .limit(0);
      if (emptyError) {
         console.error("오류:", emptyError.message);
      } else {
         console.log("빈 데이터 컬럼 구조:", emptyData);
      }
    }
  } catch (err) {
    console.error("예외 발생:", err);
  }
}

checkColumns();
