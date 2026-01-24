import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function checkUploadResult() {
    console.log("=== 방금 업로드된 데이터 분석 ===");

    // 최근 5분 내에 생성/수정된 데이터 조회
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const { data: recentFiles, error } = await supabase
        .from("measurement_business")
        .select("year, period, created_at")
        .gt("created_at", fiveMinutesAgo);

    if (error) {
        console.error("조회 실패:", error);
        return;
    }

    console.log(`최근 5분 내 생성된 데이터 총 건수: ${recentFiles.length}`);

    if (recentFiles.length === 0) {
        console.log("--> 방금 업로드된 데이터가 없습니다. (UPSERT가 업데이트만 쳤거나 실패했음)");
        // 전체 데이터 분포 확인
        const { data: allData } = await supabase.from("measurement_business").select("year");
        const dist = allData?.reduce((acc: any, curr) => {
            acc[curr.year] = (acc[curr.year] || 0) + 1;
            return acc;
        }, {});
        console.log("전체 DB 데이터 년도 분포:", dist);
        return;
    }

    const distribution = recentFiles.reduce((acc: any, curr) => {
        const key = `${curr.year}년 ${curr.period}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    console.log("\n[방금 업로드된 데이터의 년도/주기 분포]");
    console.table(distribution);

    if (recentFiles.length > 0) {
        // 샘플 데이터 확인 (년도가 2026이 아닌 것 위주로)
        const not2026 = recentFiles.filter(r => r.year !== 2026);
        if (not2026.length > 0) {
            console.log(`\n2026년이 아닌 데이터가 ${not2026.length}건 발견되었습니다!`);
            console.log("이 데이터들은 화면 조회(2026년 필터)에서 제외됩니다.");
        } else {
            console.log("\n모든 데이터가 2026년으로 인식되었습니다.");
        }
    }
}

checkUploadResult();
