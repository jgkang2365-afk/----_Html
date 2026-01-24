
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function fixYearData() {
    console.log("=== DB 데이터 년도 분포 확인 및 수정 ===\n");

    // 1. measurement_business 년도별 분포 확인
    const { data: mbAll } = await supabase
        .from("measurement_business")
        .select("year, period, code");

    if (!mbAll) {
        console.error("데이터 조회 실패");
        return;
    }

    const mbDist = mbAll.reduce((acc: any, curr) => {
        const key = `${curr.year}_${curr.period}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    console.log("measurement_business 년도/주기 분포:");
    console.table(mbDist);

    // 2. year=0인 데이터 확인
    const year0Data = mbAll.filter(r => r.year === 0 || r.year === null);
    console.log(`\nyear=0 또는 null인 데이터: ${year0Data.length}건`);

    if (year0Data.length > 0) {
        console.log("year=0 데이터 샘플 (최대 10개):", year0Data.slice(0, 10).map(d => d.code));

        // 3. year=0 데이터를 2026 상반기로 수정
        console.log("\nyear=0 데이터를 2026 상반기로 수정 중...");

        const codes = year0Data.map(d => d.code);

        // measurement_business 업데이트
        const { error: updateError } = await supabase
            .from("measurement_business")
            .update({ year: 2026, period: "상반기" })
            .in("code", codes)
            .or("year.eq.0,year.is.null");

        if (updateError) {
            console.error("measurement_business 업데이트 실패:", updateError);
        } else {
            console.log(`✓ measurement_business: ${year0Data.length}건 수정 완료`);
        }

        // measurement_target_business도 업데이트
        const { error: targetUpdateError } = await supabase
            .from("measurement_target_business")
            .update({ year: 2026, period: "상반기", plan_based_year: 2026, plan_based_period: "상반기" })
            .in("code", codes)
            .or("year.eq.0,year.is.null");

        if (targetUpdateError) {
            console.error("measurement_target_business 업데이트 실패:", targetUpdateError);
        } else {
            console.log(`✓ measurement_target_business 수정 완료`);
        }
    }

    // 4. 수정 후 다시 확인
    console.log("\n=== 수정 후 분포 확인 ===");
    const { data: mbAfter } = await supabase
        .from("measurement_business")
        .select("year, period")
        .eq("year", 2026);

    console.log(`measurement_business 2026년 데이터: ${mbAfter?.length || 0}건`);

    const { data: targetAfter } = await supabase
        .from("measurement_target_business")
        .select("year, period")
        .eq("year", 2026)
        .eq("period", "상반기");

    console.log(`measurement_target_business 2026년 상반기 데이터: ${targetAfter?.length || 0}건`);
}

fixYearData();
