import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verify() {
    console.log("--- Checking measurement_journal ---");
    const { data, error } = await supabase
        .from("measurement_journal")
        .select("code, measurement_year, measurement_period")
        .limit(1);

    if (error) {
        console.log("FAILED to query measurement_year/period in measurement_journal");
        console.log("Error:", error.message);

        console.log("\nAttempting alternative names (year, period) in measurement_journal...");
        const { data: altData, error: altError } = await supabase
            .from("measurement_journal")
            .select("code, year, period")
            .limit(1);

        if (altError) {
            console.log("FAILED alternative names (year, period) as well.");
            console.log("Error:", altError.message);
        } else {
            console.log("SUCCESS using year and period in measurement_journal.");
            console.log("Sample:", altData[0]);
        }
    } else {
        console.log("SUCCESS using measurement_year and measurement_period in measurement_journal.");
        console.log("Sample:", data[0]);
    }
}

verify();
