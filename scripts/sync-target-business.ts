import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase URL or Key is missing!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function syncTargetBusiness() {
    console.log("동기화 시작: measurement_business -> measurement_target_business");

    // 1. measurement_business 데이터 가져오기 (2026년)
    const { data: sourceData, error: sourceError } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("year", 2026);

    if (sourceError) {
        console.error("원본 데이터 조회 실패:", sourceError);
        return;
    }

    console.log(`원본 데이터(measurement_business) 건수: ${sourceData.length}`);

    if (sourceData.length === 0) {
        console.log("동기화할 데이터가 없습니다.");
        return;
    }

    // 2. measurement_target_business로 변환
    const targetRows = sourceData.map(row => ({
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
        measurer: row.measurer,
        future_measurement_date: row.future_measurement_date,
        measurement_date: row.measurement_date,
        future_measurement_period: row.future_measurement_period,
        manager_name: row.manager_name,
        manager_mobile: row.manager_mobile,
        manager_phone: row.manager_phone,
        notes: row.notes,
        is_registered: "미확정", // 기본값
        plan_based_year: row.year,
        plan_based_period: row.period
    }));

    // 3. Upsert 실행
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
            process.stdout.write(`.`);
        }
    }

    console.log(`\n동기화 완료! 성공: ${successCount}건`);
}

syncTargetBusiness();
