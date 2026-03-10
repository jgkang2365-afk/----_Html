import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkData() {
    const { data: targets, error } = await supabase
        .from("measurement_target_business")
        .select("*")
        .eq("measurement_date", "2026-01-12");

    if (error) {
        console.error("Error:", error);
        return;
    }

    console.log("Found", targets?.length, "targets on 2026-01-12");

    if (targets && targets.length > 0) {
        for (const t of targets) {
            console.log(`- ${t.business_name} (${t.code}) - EventID: ${t.google_event_id}`);

            const { data: journal } = await supabase
                .from("measurement_journal")
                .select("k2b_send_date, electronic_invoice_date")
                .eq("code", t.code)
                .eq("measurement_year", t.year)
                .eq("measurement_period", t.period)
                .maybeSingle();

            console.log(`  Journal: k2b=${journal?.k2b_send_date}, invoice=${journal?.electronic_invoice_date}`);
        }
    }
}

checkData();
