import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifyFilters() {
    console.log("Verifying filtering columns in measurement_journal...");

    // Try to query with measurement_year and measurement_period
    const { data, error } = await supabase
        .from("measurement_journal")
        .select("code, measurement_year, measurement_period")
        .limit(1);

    if (error) {
        console.error("Error querying with measurement_year/period:", error);
    } else {
        console.log("Successfully queried measurement_year and measurement_period.");
        console.log("Sample row:", JSON.stringify(data[0], null, 2));
    }

    // Also check year and period in measurement_target_business
    const { data: targetData, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("code, year, period")
        .limit(1);

    if (targetError) {
        console.error("Error querying measurement_target_business:", targetError);
    } else {
        console.log("\nSuccessfully queried year and period in measurement_target_business.");
        console.log("Sample row:", JSON.stringify(targetData[0], null, 2));
    }
}

verifyFilters();
