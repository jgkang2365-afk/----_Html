import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
    const { data, error } = await supabase
        .from("measurement_journal")
        .select("invoice_email_2, electronic_invoice_date_2, deposit_date_business_2, deposit_amount_business_2")
        .limit(1);

    if (error) {
        console.error("Columns might be missing:", error.message);
        if (error.message.includes("column") && error.message.includes("does not exist")) {
            console.log("CRITICAL: Some columns are missing!");
        }
    } else {
        console.log("SUCCESS: All columns exist in measurement_journal table.");
        console.log("Sample Data:", data[0]);
    }
}

check();
