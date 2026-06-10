
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function fixDiscrepancies2026() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  console.log("Fetching discrepant records for Year 2026...");

  const { data: journals, error } = await supabase
    .from("measurement_journal")
    .select(`
      id, code, business_name,
      deposit_amount_business, deposit_amount_business_2, deposit_amount_national, deposit_total
    `)
    .eq("measurement_year", 2026);

  if (error) {
    console.error("Error fetching data:", error);
    return;
  }

  const discrepantItems = journals.filter(j => {
    const biz1 = Number(j.deposit_amount_business || 0);
    const biz2 = Number(j.deposit_amount_business_2 || 0);
    const nat = Number(j.deposit_amount_national || 0);
    const total = Number(j.deposit_total || 0);
    return Math.abs((biz1 + biz2 + nat) - total) >= 1;
  });

  console.log(`Found ${discrepantItems.length} records to fix.`);

  if (discrepantItems.length === 0) {
    console.log("No discrepant records found. Everything is already correct!");
    return;
  }

  let successCount = 0;
  let errorCount = 0;

  for (const j of discrepantItems) {
    const biz1 = Number(j.deposit_amount_business || 0);
    const biz2 = Number(j.deposit_amount_business_2 || 0);
    const nat = Number(j.deposit_amount_national || 0);
    const newTotal = biz1 + biz2 + nat;

    const { error: updateError } = await supabase
      .from("measurement_journal")
      .update({ deposit_total: newTotal })
      .eq("id", j.id);

    if (updateError) {
      console.error(`Failed to update ID ${j.id} (${j.business_name}):`, updateError.message);
      errorCount++;
    } else {
      successCount++;
      if (successCount % 10 === 0) console.log(`Fixed ${successCount} records...`);
    }
  }

  console.log(`\nFix completed!`);
  console.log(`Successfully fixed: ${successCount} records.`);
  console.log(`Failed: ${errorCount} records.`);
}

fixDiscrepancies2026().catch(console.error);
