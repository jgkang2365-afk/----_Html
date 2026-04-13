
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function migrate() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase environment variables are missing.");
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("Adding columns to measurement_business...");
  const sql1 = `
    ALTER TABLE measurement_business 
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS fax TEXT,
    ADD COLUMN IF NOT EXISTS manager_phone TEXT;
    
    COMMENT ON COLUMN measurement_business.phone IS '사업장 대표 전화번호 (L열)';
    COMMENT ON COLUMN measurement_business.fax IS '사업장 팩스번호 (M열)';
    COMMENT ON COLUMN measurement_business.manager_phone IS '담당자 직통 전화번호 (BM열)';
  `;

  console.log("Adding columns to measurement_target_business...");
  const sql2 = `
    ALTER TABLE measurement_target_business 
    ADD COLUMN IF NOT EXISTS fax TEXT,
    ADD COLUMN IF NOT EXISTS manager_phone TEXT;
    
    COMMENT ON COLUMN measurement_target_business.fax IS '사업장 팩스번호';
    COMMENT ON COLUMN measurement_target_business.manager_phone IS '담당자 직통 전화번호';
  `;

  console.log("Adding columns to measurement_journal...");
  const sql3 = `
    ALTER TABLE measurement_journal 
    ADD COLUMN IF NOT EXISTS manager_phone TEXT;
    
    COMMENT ON COLUMN measurement_journal.manager_phone IS '담당자 직통 전화번호';
  `;

  // Try to use a common RPC for SQL execution if exists
  const { data, error } = await supabase.rpc("exec_sql", { sql_query: sql1 + sql2 + sql3 });

  if (error) {
    console.error("RPC exec_sql failed. You might need to run this SQL manually in Supabase SQL Editor:");
    console.log(sql1 + sql2 + sql3);
    
    // If RPC is missing, this is the expected failure.
    // I'll assume for now I have to tell the user if it fails, 
    // but I'll check if there's any other way.
  } else {
    console.log("Migration successful:", data);
  }
}

migrate().catch(console.error);
