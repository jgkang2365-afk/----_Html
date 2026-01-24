
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function diagnose() {
    console.log("=== 최근 업로드 데이터 진단 ===");

    // 1시간 이내 생성된 데이터 조회
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: recentData, error } = await supabase
        .from("measurement_business")
        .select("code, year, period, business_name, created_at")
        .gt("created_at", oneHourAgo);

    if (error) {
        console.error("조회 실패:", error);
        return;
    }

    console.log(`최근 1시간 내 생성/수정된 measurement_business 데이터: ${recentData.length}건`);

    if (recentData.length === 0) {
        console.log("최근 데이터가 없습니다. 업로드가 실패했거나 트랜잭션이 롤백되었을 수 있습니다.");

        // 전체 데이터 건수 확인
        const { count } = await supabase
            .from("measurement_business")
            .select("*", { count: 'exact', head: true });
        console.log(`전체 measurement_business 데이터 건수: ${count}`);
        return;
    }

    // 년도별 분포
    const yearDist = recentData.reduce((acc: any, curr) => {
        acc[curr.year] = (acc[curr.year] || 0) + 1;
        return acc;
    }, {});

    console.log("최근 데이터 년도 분포:", yearDist);

    // 2026년이 아닌 데이터 샘플 출력
    const not2026 = recentData.filter(r => r.year !== 2026);
    if (not2026.length > 0) {
        console.log("2026년이 아닌 데이터 샘플 (최대 5개):");
        console.table(not2026.slice(0, 5));
    }

    // 2026년 데이터 샘플 출력
    const is2026 = recentData.filter(r => r.year === 2026);
    if (is2026.length > 0) {
        console.log("2026년 데이터 샘플 (최대 5개):");
        console.table(is2026.slice(0, 5));
    }
}

diagnose();
