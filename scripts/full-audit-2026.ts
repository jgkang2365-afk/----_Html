
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function fullAudit2026() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("Starting full audit for Year 2026 data...");

  const { data: journals, error } = await supabase
    .from("measurement_journal")
    .select(`
      id, code, business_name, measurement_period,
      measurement_fee_total, measurement_fee_business, measurement_fee_national,
      deposit_amount_business, deposit_amount_business_2, deposit_amount_national, deposit_total
    `)
    .eq("measurement_year", 2026)
    .order("code", { ascending: true });

  if (error) {
    console.error("Error fetching data:", error);
    return;
  }

  const results = journals.map(j => {
    const feeTotal = Number(j.measurement_fee_total || 0);
    const feeBiz = Number(j.measurement_fee_business || 0);
    const feeNat = Number(j.measurement_fee_national || 0);

    const depBiz1 = Number(j.deposit_amount_business || 0);
    const depBiz2 = Number(j.deposit_amount_business_2 || 0);
    const depNat = Number(j.deposit_amount_national || 0);
    const depActualTotal = Number(j.deposit_total || 0);

    const calculatedDepTotal = depBiz1 + depBiz2 + depNat;
    const isDiscrepant = Math.abs(calculatedDepTotal - depActualTotal) >= 1;

    return {
      code: j.code,
      name: j.business_name,
      period: j.measurement_period,
      fee: { total: feeTotal, biz: feeBiz, nat: feeNat },
      paid: { biz1: depBiz1, biz2: depBiz2, nat: depNat, db_total: depActualTotal, calculated: calculatedDepTotal },
      isDiscrepant,
      diff: calculatedDepTotal - depActualTotal
    };
  });

  const discrepantItems = results.filter(r => r.isDiscrepant);
  
  console.log(`\nAudit Complete: ${journals.length} records checked.`);
  console.log(`Discrepancies found: ${discrepantItems.length} records.`);

  if (discrepantItems.length > 0) {
    // Markdown Table Format
    console.log("\n| 코드 | 업체명 | 주기 | 측정비(합계) | 사업장입금 | 국고입금 | DB합계 | 실제합계 | 차액 |");
    console.log("| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |");
    discrepantItems.forEach(r => {
      console.log(`| ${r.code} | ${r.name} | ${r.period} | ${r.fee.total.toLocaleString()} | ${(r.paid.biz1 + r.paid.biz2).toLocaleString()} | ${r.paid.nat.toLocaleString()} | ${r.paid.db_total.toLocaleString()} | ${r.paid.calculated.toLocaleString()} | **${r.diff.toLocaleString()}** |`);
    });

    const totalDiff = discrepantItems.reduce((sum, r) => sum + r.diff, 0);
    console.log(`\nTotal Discrepancy Amount: ${totalDiff.toLocaleString()} KRW`);
  }
}

fullAudit2026().catch(console.error);
