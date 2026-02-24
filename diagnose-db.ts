import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function diagnose() {
    console.log("Checking measurement_target_business data...");
    const { data: rawData, error } = await supabase
        .from("measurement_target_business")
        .select("plan_manager, year, period")
        .limit(10);

    if (error) {
        console.error("Error fetching raw data from measurement_target_business:", error);
        return;
    }

    console.log("Sample Data from measurement_target_business:");
    console.table(rawData);

    const targetManagers = ['한기문', '이주형', '강종구'];
    const { data: filteredData } = await supabase
        .from("measurement_target_business")
        .select("plan_manager, year, period")
        .in("plan_manager", targetManagers);

    console.log(`\nFiltered Data Count for Managers [${targetManagers}]:`, filteredData?.length || 0);
    if (filteredData && filteredData.length > 0) {
        console.log("First 5 filtered items:");
        console.table(filteredData.slice(0, 5));

        // Check year/period formats
        const sample = filteredData[0];
        console.log(`\nSample format: year=${sample.year} (${typeof sample.year}), period='${sample.period}'`);
    }
}

diagnose();
