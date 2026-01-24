
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function showDistribution() {
    console.log("=== measurement_business 전체 분포 ===\n");

    const { data, error } = await supabase
        .from("measurement_business")
        .select("year, period");

    if (error) {
        console.error("조회 실패:", error);
        return;
    }

    console.log(`총 데이터: ${data.length}건`);

    const dist: any = {};
    data.forEach(r => {
        const key = `${r.year}_${r.period}`;
        dist[key] = (dist[key] || 0) + 1;
    });

    console.log("\n년도_주기별 분포:");
    Object.keys(dist).sort().forEach(key => {
        console.log(`  ${key}: ${dist[key]}건`);
    });

    // 2026 상반기 조회
    const { data: data2026, count } = await supabase
        .from("measurement_business")
        .select("code, business_name, year, period", { count: "exact" })
        .eq("year", 2026)
        .eq("period", "상반기")
        .limit(5);

    console.log(`\n2026년 상반기 데이터: ${count}건`);
    if (data2026 && data2026.length > 0) {
        console.log("샘플:", data2026);
    }

    // measurement_target_business 확인
    const { count: targetCount } = await supabase
        .from("measurement_target_business")
        .select("*", { count: "exact", head: true })
        .eq("year", 2026)
        .eq("period", "상반기");

    console.log(`measurement_target_business 2026 상반기: ${targetCount}건`);
}

showDistribution();
