const { createClient } = require('@supabase/supabase-js');

async function test() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('SUPABASE_TEST_ENV_MISSING');
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const year = "2025";

    // API 내부 요약 쿼리 로직
    let query = supabase
      .from("measurement_journal")
      .select("id, business_name, designated_office, measurement_year, measurement_period, measurement_start_date, measurement_fee_total, deposit_total")
      .not("business_name", "ilike", "%번외%");

    const { data: allMeasurementForSummary, error } = await query;

    if (error) {
        console.error('ERROR (measurement):', error);
        return;
    }

    console.log('Total measurement records returned:', allMeasurementForSummary?.length);

    const yearlySummary = {};
    (allMeasurementForSummary || []).forEach((item) => {
      const y = item.measurement_year;
      if (!y) return;
      if (!yearlySummary[y]) {
          yearlySummary[y] = { count: 0, revenue: 0 };
      }
      yearlySummary[y].count++;
      yearlySummary[y].revenue += (item.measurement_fee_total || 0);
    });

    console.log('Yearly Summary from all data:', yearlySummary);

    // officeSummary (By Office) 로직 재현
    const officeSummary = {};
    (allMeasurementForSummary || []).forEach((item) => {
      const isSelectedYear = !year || item.measurement_year === parseInt(year);
      if (isSelectedYear) {
          const office = item.designated_office || "기타";
          if (!officeSummary[office]) officeSummary[office] = 0;
          officeSummary[office] += (item.measurement_fee_total || 0);
      }
    });

    console.log('Selected Year Office Summary (2025):', officeSummary);
}

test();
