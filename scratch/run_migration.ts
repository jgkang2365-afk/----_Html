import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  const sql = `
    -- 1. measurement_business 테이블에 national_support_status 컬럼 추가
    ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS national_support_status VARCHAR(20);
    
    -- 2. 기존 CHECK 제약 조건 제거
    ALTER TABLE measurement_business DROP CONSTRAINT IF EXISTS measurement_business_national_support_status_check;
    
    -- 3. CHECK 제약 조건 새로 설정 ('대상', '비대상' 허용)
    ALTER TABLE measurement_business ADD CONSTRAINT measurement_business_national_support_status_check CHECK (national_support_status IN ('대상', '비대상'));
    
    -- 4. 검색 최적화를 위한 인덱스 생성
    CREATE INDEX IF NOT EXISTS idx_measurement_business_national_support ON measurement_business(national_support_status);
  `;

  console.log("SQL 마이그레이션 실행 중...");
  
  let success = false;
  for (const rpcName of ["exec_sql", "execute_sql", "run_sql"]) {
    try {
      console.log(`RPC '${rpcName}' (sql_query 인자) 호출 시도...`);
      const { data, error } = await supabase.rpc(rpcName, { sql_query: sql });
      if (error) {
        console.log(`- sql_query 인자 실패: ${error.message}. sql 인자 시도...`);
        const { data: data2, error: error2 } = await supabase.rpc(rpcName, { sql: sql });
        if (error2) {
          throw new Error(error2.message);
        }
        console.log(`RPC '${rpcName}' (sql 인자) 성공 완료!`, data2);
      } else {
        console.log(`RPC '${rpcName}' (sql_query 인자) 성공 완료!`, data);
      }
      success = true;
      break;
    } catch (err: any) {
      console.warn(`RPC '${rpcName}' 시도 실패:`, err.message || err);
    }
  }

  if (success) {
    console.log("마이그레이션 성공!");
  } else {
    console.error("모든 RPC 시도가 실패했습니다.");
  }
}

runMigration().catch(console.error);
