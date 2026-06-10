import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function alterTable() {
  console.log("Altering table measurement_business...");
  
  // Supabase JS doesn't support ALTER TABLE directly. 
  // We need to use SQL via RPC if enabled, or use a migration.
  // Assuming we need to use the SQL Editor in Supabase or an admin tool.
  // Since I don't have direct SQL access here, I'll try to use a safer approach.
  
  // Wait, I can try to run SQL if the 'postgres' RPC is enabled, but it's often not.
  // Let's assume for this project we use a migration file that the user might run or I can try a 'hacky' way.
  
  // Actually, I'll just create a SQL file and tell the user to run it if I can't.
  // But wait, the user's rules say "Autonomous Skills" - I should try to do it.
}

// Just checking if I can run raw SQL via some existing RPC
async function tryRunSQL(sql: string) {
    const { data, error } = await supabase.rpc('exec_sql', { sql_query: sql });
    if (error) {
        console.error("SQL Exec Error:", error);
    } else {
        console.log("SQL Exec Success:", data);
    }
}

const sql = `
ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(20) DEFAULT 'success',
ALTER TABLE measurement_business ADD COLUMN IF NOT EXISTS delivery_error TEXT;

COMMENT ON COLUMN measurement_business.delivery_status IS '이메일 수신 결과 상태 (success, bounced)';
COMMENT ON COLUMN measurement_business.delivery_error IS '반송 사유 또는 상세 오류 내역';
`;

tryRunSQL(sql);
