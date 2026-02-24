import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectLotte() {
    console.log("Searching for '롯데건설(주)이촌현대아파트 리모델링현장'...");

    // 1. Target Business
    const { data: targets, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("*")
        .ilike("business_name", "%롯데건설%이촌현대%");

    if (targetError) {
        console.error("Error fetching targets:", targetError);
        return;
    }

    console.log("\n--- Target Businesses ---");
    console.log(JSON.stringify(targets, null, 2));

    if (targets && targets.length > 0) {
        const codes = targets.map(t => t.code);

        // 2. Journals
        const { data: journals, error: journalError } = await supabase
            .from("measurement_journal")
            .select("*")
            .in("code", codes);

        if (journalError) {
            console.error("Error fetching journals:", journalError);
            return;
        }

        console.log("\n--- Journals Registered ---");
        console.log(JSON.stringify(journals, null, 2));
    }
}

inspectLotte();
