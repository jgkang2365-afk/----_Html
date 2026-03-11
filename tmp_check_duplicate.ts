import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkDuplicate() {
    console.log("Checking for duplicate: code='H0413', year=2026, period='상반기'...");
    const { data, error } = await supabase
        .from("measurement_target_business")
        .select("*")
        .eq("code", "H0413")
        .eq("year", 2026)
        .eq("period", "상반기");

    if (error) {
        console.error("Error fetching data:", error);
        return;
    }

    if (data && data.length > 0) {
        console.log("Found existing record(s):");
        data.forEach((r, i) => {
            console.log(`${i+1}. ID: ${r.id}, Name: ${r.business_name}, Code: ${r.code}, Year: ${r.year}, Period: ${r.period}, Manager: ${r.plan_manager}`);
        });
    } else {
        console.log("No existing record found for this combination.");
    }
}

checkDuplicate();
