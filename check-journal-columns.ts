import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkColumns() {
    console.log("Checking columns for measurement_journal...");
    const { data: journalData, error } = await supabase
        .from("measurement_journal")
        .select("*")
        .limit(1);

    if (error) {
        console.error("Error fetching data from measurement_journal:", error);
        return;
    }

    if (journalData && journalData.length > 0) {
        console.log("Columns in measurement_journal:");
        console.log(Object.keys(journalData[0]));
    } else {
        console.log("No data found in measurement_journal to check columns.");
    }
}

checkColumns();
