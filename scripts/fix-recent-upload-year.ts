
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function fixAndSync() {
    console.log("=== 최근 업로드 데이터 년도 보정 및 동기화 수행 ===");

    // 1. 최근 1시간 내 생성된 데이터 중 2026년이 아닌 데이터 조회
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const { data: recentWrongYearData, error: fetchError } = await supabase
        .from("measurement_business")
        .select("code")
        .gt("created_at", oneHourAgo)
        .neq("year", 2026);

    if (fetchError) {
        console.error("데이터 조회 실패:", fetchError);
        return;
    }

    console.log(`발견된 2026년이 아닌 최근 데이터: ${recentWrongYearData.length}건`);

    if (recentWrongYearData.length > 0) {
        const codes = recentWrongYearData.map(r => r.code);

        // 2. 2026년으로 업데이트
        const { error: updateError } = await supabase
            .from("measurement_business")
            .update({ year: 2026, period: '상반기' }) // 주기는 상반기로 가정 (필요시 조정 가능)
            .in("code", codes)
            .gt("created_at", oneHourAgo); // 이중 안전장치

        if (updateError) {
            console.error("데이터 업데이트 실패:", updateError);
            return;
        }

        console.log("--> 해당 데이터들의 년도를 2026년, 주기를 상반기로 보정했습니다.");
    } else {
        console.log("보정할 데이터가 없습니다.");
    }

    // 3. 동기화 수행 (measurement_business -> measurement_target_business)
    console.log("\n[동기화 재시도] measurement_business -> measurement_target_business");

    // 2026년 데이터 조회
    const { data: sourceData, error: sourceError } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("year", 2026);

    if (sourceError || !sourceData) {
        console.error("2026년 원본 데이터 조회 실패:", sourceError);
        return;
    }

    console.log(`동기화 대상 데이터(2026년) 건수: ${sourceData.length}`);

    if (sourceData.length === 0) {
        console.log("동기화할 데이터가 없습니다.");
        return;
    }

    // 변환 및 Upsert
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
        completion_status: row.completion_status,
        measurer: row.measurer,
        future_measurement_date: row.future_measurement_date,
        measurement_date: row.measurement_date,
        future_measurement_period: row.future_measurement_period,
        manager_name: row.manager_name,
        manager_mobile: row.manager_mobile,
        manager_phone: row.manager_phone,
        notes: row.notes,
        is_registered: false,
        plan_based_year: row.year,
        plan_based_period: row.period
    }));

    // 배치 처리
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

    console.log(`\n\n최종 결과: 294건 중 ${successCount}건이 동기화되었습니다.`);
}

fixAndSync();
