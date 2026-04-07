import { createClient } from './lib/supabase/server.ts';
import { toShortName } from './lib/constants/designated-offices.ts';

async function test() {
    const supabase = await createClient();
    const year = "2026"; // 메인 필터가 2026인 상황 재현
    
    // API 내부 로직과 동일하게 실행
    let measurementSummaryQuery = supabase
      .from("measurement_journal")
      .select("id, business_name, designated_office, measurement_year, measurement_period, measurement_start_date, measurement_fee_total, deposit_total")
      .not("business_name", "ilike", "%번외%");
    
    // applyFilters(..., false, true) 적용 (excludeYear: true)
    const { data, error } = await measurementSummaryQuery;
    
    if (error) {
        console.error('ERROR:', error);
        return;
    }
    
    console.log('Total records returned for summary:', data?.length);
    
    const years = new Set(data?.map(i => i.measurement_year));
    console.log('Years present in response:', Array.from(years).sort());
    
    const count2025 = data?.filter(i => i.measurement_year === 2025).length;
    console.log('Count of 2025 records:', count2025);

    const count2026 = data?.filter(i => i.measurement_year === 2026).length;
    console.log('Count of 2026 records:', count2026);
}

test();
