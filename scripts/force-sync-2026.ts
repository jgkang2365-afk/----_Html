
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function fix2026Data() {
    console.log("=== 2026년 상반기 데이터 강제 추가 ===");

    // 1. measurement_business에서 2026년 상반기 데이터 조회
    const { data: mbData, error: mbError } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("year", 2026)
        .eq("period", "상반기");

    if (mbError) {
        console.error("measurement_business 조회 실패:", mbError);
        return;
    }

    console.log(`measurement_business에서 2026년 상반기 데이터: ${mbData?.length || 0}건`);

    // 2. measurement_target_business에서 2026년 상반기 데이터 조회
    const { data: targetData, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("code")
        .eq("year", 2026)
        .eq("period", "상반기");

    if (targetError) {
        console.error("measurement_target_business 조회 실패:", targetError);
        return;
    }

    console.log(`measurement_target_business에서 2026년 상반기 데이터: ${targetData?.length || 0}건`);

    // 3. 만약 measurement_business에 2026 데이터가 없으면, 엑셀 파싱 문제.
    // measurement_business의 모든 년도 분포 확인
    const { data: allMbData } = await supabase
        .from("measurement_business")
        .select("year");

    if (allMbData) {
        const dist = allMbData.reduce((acc: any, curr) => {
            acc[curr.year] = (acc[curr.year] || 0) + 1;
            return acc;
        }, {});
        console.log("\nmeasurement_business 년도 분포:");
        console.table(dist);
    }

    // 4. 2026 데이터가 measurement_business에 있다면 measurement_target_business로 복사
    if (mbData && mbData.length > 0) {
        console.log("\n2026년 데이터를 measurement_target_business로 복사 중...");

        const targetRows = mbData.map(row => ({
            code: row.code,
            year: row.year,
            period: row.period,
            business_name: row.business_name,
            business_number: row.business_number,
            total_employees: row.total_employees,
            address: row.address,
            office_jurisdiction: row.office_jurisdiction,
            designated_office: row.designated_office,
            measurement_start_date: row.measurement_start_date,
            measurement_end_date: row.measurement_end_date,
            completion_status: row.completion_status,
            measurer: row.measurer,
            future_measurement_date: row.future_measurement_date,
            measurement_date: row.measurement_date,
            future_measurement_period: row.future_measurement_period,
            manager_name: row.manager_name,
            manager_mobile: row.manager_mobile,
            manager_phone: row.manager_phone,
            notes: row.notes,
            business_category: row.business_category,
            is_registered: false,
            plan_based_year: row.year,
            plan_based_period: row.period
        }));

        const batchSize = 100;
        let successCount = 0;

        for (let i = 0; i < targetRows.length; i += batchSize) {
            const batch = targetRows.slice(i, i + batchSize);
            const { error: upsertError } = await supabase
                .from("measurement_target_business")
                .upsert(batch, { onConflict: "code,year,period" });

            if (upsertError) {
                console.error(`배치(${i}) 업서트 실패:`, upsertError);
            } else {
                successCount += batch.length;
            }
        }

        console.log(`\n✓ ${successCount}건 동기화 완료!`);
    } else {
        console.log("\n❌ measurement_business에 2026년 상반기 데이터가 없습니다.");
        console.log("엑셀 파일의 '년도' 컬럼이 제대로 파싱되지 않았을 수 있습니다.");
    }
}

fix2026Data();
