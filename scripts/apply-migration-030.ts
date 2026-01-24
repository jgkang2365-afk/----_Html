import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function runMigration() {
    try {
        console.log("Applying Migration 030 (Relax Constraints)...");

        // SQL Content: Relax Check Constraints AND Drop strict FK to allow 'Su-si' periods
        const sql = `
        -- 1. 측정일지 테이블의 측정주기(measurement_period) CHECK 제약조건 완화
        ALTER TABLE measurement_journal DROP CONSTRAINT IF EXISTS measurement_journal_measurement_period_check;
        ALTER TABLE measurement_journal ADD CONSTRAINT measurement_journal_measurement_period_check 
            CHECK (measurement_period IN ('상반기', '하반기', '상반기(수시)', '하반기(수시)', '1분기', '2분기', '3분기', '4분기'));

        -- 2. 측정사업장 테이블의 측정주기(period) CHECK 제약조건 완화
        ALTER TABLE measurement_business DROP CONSTRAINT IF EXISTS measurement_business_period_check;
        ALTER TABLE measurement_business ADD CONSTRAINT measurement_business_period_check 
            CHECK (period IN ('상반기', '하반기', '상반기(수시)', '하반기(수시)', '1분기', '2분기', '3분기', '4분기'));

        -- 3. FK 제약조건 완화 (measurement_business와의 엄격한 연결 해제)
        -- 기존: (code, year, period)가 일치해야 함 -> 수시 측정 시 불일치 발생 가능
        -- 변경: code만 business_info와 일치하면 되도록 변경 (또는 measurement_business의 code와)
        ALTER TABLE measurement_journal DROP CONSTRAINT IF EXISTS fk_measurement_journal_code;
        
        -- business_info(code)를 참조하도록 변경 (만약 business_info에 없는 코드가 있다면 에러 발생할 수 있으므로 주의)
        -- 안전을 위해 IF EXISTS로 business_info 참조 시도, 실패 시 무시? 
        -- 여기서는 엄격한 FK를 제거하는 것이 핵심.
        
        -- (선택) business_info와 연결 시도
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'business_info') THEN
                ALTER TABLE measurement_journal 
                ADD CONSTRAINT fk_measurement_journal_business_info 
                FOREIGN KEY (code) REFERENCES business_info(code);
            END IF;
        EXCEPTION WHEN others THEN
            RAISE NOTICE 'Skipping FK creation to business_info (might violate integrity)';
        END $$;

        -- 4. PostgREST 캐시 갱신
        NOTIFY pgrst, 'reload config';
        `;

        const { error } = await supabase.rpc('exec_sql', { sql_query: sql }); // Requires RPC function usually

        // If RPC not available, we can't run DDL via client easily unless 'postgres' role.
        // But 'anon' key usually can't run DDL.
        // Wait, scripts usually use Service Role Key?
        // The user environment might not have Service Role Key in .env.local usually.
        // But reset-2026.ts used ANON key? It did DELETE. DELETE is DML.
        // ALTER is DDL. Standard Supabase client cannot run DDL.

        console.warn("Supabase Client cannot execute DDL directly. Please run 'lib/db/migrations/030_relax_constraints.sql' in Supabase SQL Editor.");

    } catch (e) {
        console.error(e);
    }
}

// Since we cannot run DDL from client (unless we have a special RPC setup), 
// I will create the SQL file and ask the user to run it, 
// OR I will assume there is an RPC 'exec_sql' or similar I can use?
// Usually not.
// However, the user error `violate check constraint` proves the DB enforces it.
// I must update the DB.

// Let's create the SQL file.
runMigration();
