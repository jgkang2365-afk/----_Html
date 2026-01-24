
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function checkDist() {
    console.log("=== measurement_target_business 데이터 분포 확인 ===");

    const { data, error } = await supabase
        .from("measurement_target_business")
        .select("year, period");

    if (error) {
        console.error("조회 실패:", error);
        return;
    }

    console.log(`총 데이터 건수: ${data.length}`);

    const dist = data.reduce((acc: any, curr) => {
        const key = `${curr.year}_${curr.period}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    console.table(dist);

    console.log("\n=== 2026년 상반기 데이터 샘플 (최대 5개) ===");
    const sample2026 = await supabase
        .from("measurement_target_business")
        .select("*")
        .eq("year", 2026)
        .eq("period", "상반기")
        .limit(5);

    if (sample2026.data) {
        console.table(sample2026.data.map(d => ({
            code: d.code,
            business_name: d.business_name,
            manager_mobile: d.manager_mobile,
            is_registered: d.is_registered
        })));
    }
}

checkDist();
