import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function reset2026Data() {
    console.log("2026년 데이터 초기화 시작...");

    // 1. measurement_target_business 삭제 (year = 2026 OR plan_based_year = 2026)
    const { error: targetError } = await supabase
        .from("measurement_target_business")
        .delete()
        .or('year.eq.2026,plan_based_year.eq.2026');

    if (targetError) console.error("타겟 삭제 실패:", targetError);
    else console.log("타겟 테이블 2026년 데이터 삭제 완료");

    // 2. measurement_business 삭제 (year = 2026)
    const { error: sourceError } = await supabase
        .from("measurement_business")
        .delete()
        .eq("year", 2026);

    if (sourceError) console.error("원본 삭제 실패:", sourceError);
    else console.log("원본 테이블 2026년 데이터 삭제 완료");

    console.log("초기화 완료. 이제 엑셀을 다시 업로드하세요.");
}

reset2026Data();
