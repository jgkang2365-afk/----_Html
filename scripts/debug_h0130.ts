
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Use process.cwd() instead of __dirname
const envPath = path.resolve(process.cwd(), ".env.local");
dotenv.config({ path: envPath });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function debugSpecificBusiness(code: string) {
    console.log(`=== Debugging Business: ${code} ===`);

    // 1. measurement_business history
    const { data: allBusinessHistory, error: historyError } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("code", code)
        .order("year", { ascending: false })
        .order("period", { ascending: false });

    if (historyError) {
        console.error("History Error:", historyError);
    } else {
        console.log(`\n[measurement_business History: ${allBusinessHistory?.length} records]`);
        if (allBusinessHistory) {
            console.table(allBusinessHistory.map(b => ({
                year: b.year,
                period: b.period,
                industrial_accident_number: b.industrial_accident_number,
                invoice_email: b.invoice_email,
                manager_name: b.manager_name
            })));
        }
    }

    // 2. measurement_journal recent
    const { data: recentJournals, error: journalError } = await supabase
        .from("measurement_journal")
        .select("measurement_year, measurement_period, industrial_accident_number, invoice_email, manager_name")
        .eq("code", code)
        .order("measurement_year", { ascending: false })
        .order("measurement_period", { ascending: false })
        .limit(5);

    if (journalError) {
        console.error("Journal Error:", journalError);
    } else {
        console.log(`\n[measurement_journal Recent: ${recentJournals?.length} records]`);
        if (recentJournals) {
            console.table(recentJournals);
        }
    }
}

debugSpecificBusiness("H0130").catch(console.error);
