
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fixNationalSupportStatus() {
    console.log("Starting National Support Status Correction...");

    // 1. Find incorrect records in national_support_application
    const { data: incorrectApps, error: fetchError } = await supabase
        .from("national_support_application")
        .select("*")
        .ilike("result", "%비대상%")
        .eq("national_support_status", "지원");

    if (fetchError) {
        console.error("Error fetching incorrect records:", fetchError);
        return;
    }

    console.log(`Found ${incorrectApps.length} incorrect records in national_support_application.`);

    let updatedAppCount = 0;
    let updatedJournalCount = 0;

    for (const app of incorrectApps) {
        // Update national_support_application
        const { error: updateAppError } = await supabase
            .from("national_support_application")
            .update({ national_support_status: "비대상" })
            .eq("id", app.id);

        if (updateAppError) {
            console.error(`Failed to update application ${app.id}:`, updateAppError);
        } else {
            updatedAppCount++;
            console.log(`Fixed application ${app.id} (${app.code} - ${app.year} ${app.period})`);

            // Update corresponding measurement_journal
            const { data: journals, error: fetchJournalError } = await supabase
                .from("measurement_journal")
                .select("id")
                .eq("code", app.code)
                .eq("measurement_year", app.year)
                .eq("measurement_period", app.period)
                .eq("national_support_status", "지원"); // update only if currently '지원'

            if (!fetchJournalError && journals && journals.length > 0) {
                for (const journal of journals) {
                    const { error: updateJournalError } = await supabase
                        .from("measurement_journal")
                        .update({ national_support_status: "비대상" })
                        .eq("id", journal.id);

                    if (updateJournalError) {
                        console.error(`Failed to update journal ${journal.id}:`, updateJournalError);
                    } else {
                        updatedJournalCount++;
                        console.log(`  -> Fixed journal ${journal.id}`);
                    }
                }
            }
        }
    }

    console.log("Correction complete.");
    console.log(`Updated ${updatedAppCount} applications.`);
    console.log(`Updated ${updatedJournalCount} journals.`);
}

fixNationalSupportStatus();
