import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const connectionString = process.env.DATABASE_URL || process.env.DIRECT_URL;

// 사용자 테이블에 국고 일괄 권한 컬럼 추가 스크립트
async function run() {
  const sql = "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_national_support_manager BOOLEAN DEFAULT false;";
  console.log("SQL 실행 시도:", sql);

  // 1. Supabase RPC exec_sql 시도
  if (supabaseUrl && supabaseKey) {
    try {
      console.log("Supabase RPC exec_sql 방식 시도...");
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { error } = await supabase.rpc("exec_sql", { sql_query: sql });
      if (!error) {
        console.log("RPC exec_sql 실행 성공!");
        return;
      }
      console.log("RPC exec_sql 실패:", error.message);
    } catch (e: any) {
      console.log("RPC 예외:", e.message);
    }
  }

  // 2. pg Client 직접 연결 시도
  if (connectionString) {
    try {
      console.log("PostgreSQL pg Client 직접 연결 시도...");
      const client = new Client({ connectionString });
      await client.connect();
      await client.query(sql);
      await client.end();
      console.log("pg Client 직접 실행 성공!");
      return;
    } catch (e: any) {
      console.error("pg 직접 연결 실패:", e.message);
    }
  }

  console.error("모든 DDL 실행 시도가 실패했습니다. .env.local 설정을 확인해주세요.");
}

run();
