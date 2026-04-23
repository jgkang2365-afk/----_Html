
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function checkDiscrepancies() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("Checking for deposit discrepancies in measurement_journal (Year 2026)...");

  const { data: journals, error } = await supabase
    .from("measurement_journal")
    .select("id, code, business_name, measurement_year, measurement_period, deposit_amount_business, deposit_amount_business_2, deposit_amount_national, deposit_total")
    .eq("measurement_year", 2026);

  if (error) {
    console.error("Error fetching data:", error);
    return;
  }

  const discrepancies = journals.filter(j => {
    const biz1 = Number(j.deposit_amount_business || 0);
    const biz2 = Number(j.deposit_amount_business_2 || 0);
    const nat = Number(j.deposit_amount_national || 0);
    const total = Number(j.deposit_total || 0);
    // 부동소수점 오차 방지를 위해 차이가 1원 이상인 경우만 체크
    return Math.abs((biz1 + biz2 + nat) - total) >= 1;
  });

  console.log(`Found ${discrepancies.length} inconsistent records.`);

  if (discrepancies.length > 0) {
    const result = discrepancies.map(j => {
      const biz1 = Number(j.deposit_amount_business || 0);
      const biz2 = Number(j.deposit_amount_business_2 || 0);
      const nat = Number(j.deposit_amount_national || 0);
      const expected = biz1 + biz2 + nat;
      const actual = Number(j.deposit_total || 0);
      const diff = expected - actual;
      return {
        id: j.id,
        code: j.code,
        name: j.business_name,
        period: j.measurement_period,
        biz1,
        biz2,
        nat,
        actual_total: actual,
        expected_total: expected,
        diff
      };
    });
    
    console.log(JSON.stringify(result, null, 2));
    
    const totalDiff = result.reduce((sum, item) => sum + item.diff, 0);
    console.log(`\nTotal Difference Sum: ${totalDiff.toLocaleString()} KRW`);
  }
}

checkDiscrepancies().catch(console.error);
