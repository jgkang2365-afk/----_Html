import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function checkDbStatus() {
    console.log("=== DB 상태 점검 ===");

    // 1. measurement_business (원본) 확인
    const { count: sourceCount, error: sourceError } = await supabase
        .from("measurement_business")
        .select("*", { count: 'exact', head: true })
        .eq("year", 2026);

    console.log(`1. measurement_business (2026): ${sourceCount}건`);
    if (sourceError) console.error("Error:", sourceError);

    // 2. measurement_target_business (타겟) 확인
    const { count: targetCount, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("*", { count: 'exact', head: true })
        .eq("year", 2026);

    console.log(`2. measurement_target_business (2026): ${targetCount}건`);
    if (targetError) console.error("Error:", targetError);

    // 3. 타겟 테이블의 plan_based_year 확인 (NULL 체크)
    const { data: nullCheck, error: nullError } = await supabase
        .from("measurement_target_business")
        .select("code, year, plan_based_year")
        .eq("year", 2026)
        .limit(5);

    console.log("3. 샘플 데이터 (plan_based_year 확인):");
    console.table(nullCheck);

    if (sourceCount && sourceCount > 0 && (!targetCount || targetCount === 0)) {
        console.log("\n[진단] 원본에는 데이터가 있으나 타겟에는 없습니다.");
        console.log("원인 추정: 동기화 과정에서 INSERT 실패 (아마도 NOT NULL 제약조건 위반)");
    }
}

checkDbStatus();
