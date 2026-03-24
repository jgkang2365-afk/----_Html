import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkSannae() {
    const businessName = "산내모터스";
    console.log(`Checking data for: ${businessName}`);

    // 1. Find in measurement_target_business
    const { data: targets, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("*")
        .ilike("business_name", `%${businessName}%`)
        .eq("measurement_date", "2026-02-23");

    if (targetError) {
        console.error("Error fetching target business:", targetError);
        return;
    }

    if (!targets || targets.length === 0) {
        console.log("No business found for '산내모터스' on 2026-02-23");
        // Try searching without date
        const { data: allTargets } = await supabase
            .from("measurement_target_business")
            .select("*")
            .ilike("business_name", `%${businessName}%`);
        console.log("All matching businesses:", allTargets);
        return;
    }

    for (const target of targets) {
        console.log("\n--- Target Business ---");
        console.log(`ID: ${target.id}`);
        console.log(`Code: ${target.code}`);
        console.log(`Name: ${target.business_name}`);
        console.log(`Date: ${target.measurement_date}`);
        console.log(`Status: ${target.is_registered}`);
        console.log(`Event ID: ${target.google_event_id}`);
        console.log(`Year: ${target.year}, Period: ${target.period}`);

        // 2. Check measurement_journal
        const { data: journals, error: journalError } = await supabase
            .from("measurement_journal")
            .select("*")
            .eq("code", target.code)
            .eq("measurement_year", target.year)
            .eq("measurement_period", target.period);

        if (journalError) {
            console.error("Error fetching journal:", journalError);
            continue;
        }

        if (!journals || journals.length === 0) {
            console.log("No journal found for this business record.");
        } else {
            for (const journal of journals) {
                console.log("\n--- Journal ---");
                console.log(`K2B Send Date: ${journal.k2b_send_date}`);
                console.log(`Invoice Date: ${journal.electronic_invoice_date}`);
                const isCompleted = journal.k2b_send_date && journal.electronic_invoice_date;
                console.log(`Condition Met: ${!!isCompleted}`);
            }
        }

        // 3. Check preliminary_survey
        const { data: surveys } = await supabase
            .from("preliminary_survey")
            .select("*")
            .eq("code", target.code)
            .eq("year", target.year)
            .eq("period", target.period);
        
        console.log("\n--- Preliminary Survey ---");
        console.log(`Survey found: ${surveys && surveys.length > 0}`);
        if (surveys) {
            surveys.forEach(s => console.log(`  - ID: ${s.id}, Date: ${s.measurement_date}`));
        }
    }
}

checkSannae();
