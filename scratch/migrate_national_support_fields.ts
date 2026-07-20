import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
    const sql = `
        ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS sync_status VARCHAR(50) DEFAULT '대기';
        ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS sync_error_message TEXT;
        ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS industrial_accident_number VARCHAR(50);
        ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS commencement_number VARCHAR(50);
        ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS representative_name VARCHAR(100);
    `;

    console.log("SQL 마이그레이션 실행 중...");
    
    // 여러 variant 명칭 매핑 시도
    let success = false;
    for (const rpcName of ["exec_sql", "execute_sql", "run_sql"]) {
        try {
            console.log(`RPC '${rpcName}' 호출 시도...`);
            const { data, error } = await supabase.rpc(rpcName, { sql_query: sql });
            if (error) {
                // 다른 인자 명칭 시도 (sql 등)
                const { error: error2 } = await supabase.rpc(rpcName, { sql: sql });
                if (error2) {
                    throw new Error(error2.message);
                }
            }
            console.log(`RPC '${rpcName}' 성공 완료!`);
            success = true;
            break;
        } catch (err: any) {
            console.warn(`RPC '${rpcName}' 실패:`, err.message || err);
        }
    }

    if (success) {
        console.log("마이그레이션이 성공적으로 완료되었습니다!");
    } else {
        console.error("마이그레이션에 실패했습니다. DB RPC 명칭이나 인자를 확인해 주세요.");
    }
}

runMigration();
