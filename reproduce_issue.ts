import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { syncBusinessToCalendar } from "./lib/google/sync-service";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function reproduce() {
    const code = "H0216"; // (주)신이십일세기자동차정비 (2/23)
    const year = 2026;
    const period = "상반기";

    console.log(`[Repro] Checking data for ${code}...`);
    
    // Check if it already has completion dates
    const { data: journal } = await supabase
        .from("measurement_journal")
        .select("k2b_send_date, electronic_invoice_date")
        .eq("code", code)
        .eq("measurement_year", year)
        .eq("measurement_period", period)
        .maybeSingle();
    
    console.log(`[Repro] Journal Data:`, journal);

    if (journal?.k2b_send_date && journal?.electronic_invoice_date) {
        console.log(`[Repro] Triggering sync...`);
        try {
            const result = await syncBusinessToCalendar(supabase, code, year, period);
            console.log(`[Repro] Sync Result:`, result ? "Success" : "No action");
            if (result && result.colorId) {
                console.log(`[Repro] Event ColorId:`, result.colorId);
            }
        } catch (e) {
            console.error(`[Repro] Sync Error:`, e);
        }
    } else {
        console.log(`[Repro] Completion criteria not met for this test.`);
    }
}

reproduce();
