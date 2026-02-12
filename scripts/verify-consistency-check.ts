import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { verifyDataConsistency } from "../lib/sync/verification";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function main() {
    console.log("Creating standalone Supabase client...");
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log("Inspecting table structure...");

    const { data: bData } = await supabase.from("business_info").select("*").limit(1);
    if (bData && bData.length > 0) {
        console.log("business_info keys:", Object.keys(bData[0]));
        console.log("business_info sample:", bData[0]);
    }

    const { data: mData } = await supabase.from("measurement_business").select("*").limit(1);
    if (mData && mData.length > 0) {
        console.log("measurement_business keys:", Object.keys(mData[0]));
        console.log("measurement_business sample:", mData[0]);
    }

    const { data: jData } = await supabase.from("measurement_journal").select("*").limit(1);
    if (jData && jData.length > 0) {
        console.log("measurement_journal keys:", Object.keys(jData[0]));
        console.log("measurement_journal sample:", jData[0]);
    }

    const { data: tData } = await supabase.from("measurement_target_business").select("*").limit(1);
    if (tData && tData.length > 0) {
        console.log("measurement_target_business keys:", Object.keys(tData[0]));
        console.log("measurement_target_business sample:", tData[0]);
    }

    // process.exit(0); removed

    console.log("Running verification check...");

    // 1. Run verification with external client
    const result = await verifyDataConsistency(supabase);
    console.log("Verification Result:", result);

    // 2. Check DB
    const { data: issues, error } = await supabase
        .from("data_verification_issues")
        .select("*");

    if (error) {
        console.error("Error fetching issues:", error);
        return;
    }

    console.log(`Found ${issues?.length} issues in DB.`);
    if (issues && issues.length > 0) {
        console.log("Sample issues:", issues.slice(0, 3));
    }
}

main().catch(console.error);
