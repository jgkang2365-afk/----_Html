import { createClient } from "@supabase/supabase-js";
import { syncBusinessToCalendar } from "../lib/google/sync-service";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function auditRecentUpdates() {
  const targetDates = ["2026-04-27", "2026-04-28"];
  
  console.log(`[Audit] Searching for journals updated on ${targetDates.join(", ")}...`);

  const { data: journals, error } = await supabase
    .from("measurement_journal")
    .select("code, measurement_year, measurement_period, k2b_send_date, electronic_invoice_date")
    .or(`k2b_send_date.in.(${targetDates.join(",")}),electronic_invoice_date.in.(${targetDates.join(",")})`);

  if (error) {
    console.error("[Audit] Error fetching journals:", error);
    return;
  }

  if (!journals || journals.length === 0) {
    console.log("[Audit] No journals found with recent updates.");
    return;
  }

  console.log(`[Audit] Found ${journals.length} journals to verify.`);

  for (const journal of journals) {
    console.log(`\n[Audit] Checking ${journal.code} (${journal.measurement_year}/${journal.measurement_period})`);
    console.log(`  K2B: ${journal.k2b_send_date}, Invoice: ${journal.electronic_invoice_date}`);

    try {
      const result = await syncBusinessToCalendar(supabase, journal.code, journal.measurement_year, journal.measurement_period);
      console.log(`  [Audit] Sync Result:`, result);
      
      // Delay for Rate Limit
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      console.error(`  [Audit] Sync Failed:`, err);
    }
  }

  console.log("\n[Audit] All recent updates audited and synced.");
}

auditRecentUpdates();
