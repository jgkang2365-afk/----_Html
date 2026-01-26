
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
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

async function debugData() {
    console.log("=== Debugging Data Availability ===");

    // 1. Check if ANY measurement_business has industrial_accident_number
    const { data: businessData, error: businessError } = await supabase
        .from("measurement_business")
        .select("code, business_name, industrial_accident_number")
        .not("industrial_accident_number", "is", null)
        .not("industrial_accident_number", "eq", "")
        .limit(5);

    if (businessError) console.error("Business Error:", businessError);
    console.log("Measurement Business with industrial_accident_number:", businessData?.length || 0);
    if (businessData && businessData.length > 0) {
        console.log("Sample:", businessData[0]);
    }

    // 2. Check if ANY measurement_journal has industrial_accident_number
    const { data: journalData, error: journalError } = await supabase
        .from("measurement_journal")
        .select("code, business_name, measurement_year, measurement_period, industrial_accident_number")
        .not("industrial_accident_number", "is", null)
        .not("industrial_accident_number", "eq", "")
        .order("created_at", { ascending: false })
        .limit(5);

    if (journalError) console.error("Journal Error:", journalError);
    console.log("Measurement Journals with industrial_accident_number:", journalData?.length || 0);
    if (journalData && journalData.length > 0) {
        console.log("Sample:", journalData[0]);

        // Pick one code to test the logic
        const testCode = journalData[0].code;
        console.log(`\n=== Testing Logic for Code: ${testCode} ===`);
        await testLogicForCode(testCode);
    } else {
        console.log("No journals found with industrial_accident_number. Data might be missing.");
    }
}

async function testLogicForCode(code: string) {
    // Simulate the API logic

    // 1. measurement_business history
    const { data: allBusinessHistory } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("code", code)
        .order("year", { ascending: false })
        .order("period", { ascending: false });

    console.log(`Business History Count: ${allBusinessHistory?.length}`);

    // Base Data (Current) - Simulate 2026/Sangban
    const year = 2026;
    const period = "상반기";

    let baseBusinessData = allBusinessHistory?.find(
        (b: any) => b.year === year && b.period === period
    );

    // Prioritized Defaults logic
    const findFirstValue = (field: string) => {
        if (!allBusinessHistory) return null;
        for (const record of allBusinessHistory) {
            if (record[field]) return record[field];
        }
        return null;
    };

    const prioritizedDefaults = {
        industrial_accident_number: findFirstValue("industrial_accident_number"),
        invoice_email: findFirstValue("invoice_email"),
    };

    console.log("Prioritized Defaults (from History):", prioritizedDefaults);

    // 2. measurement_journal recent
    const { data: recentJournals } = await supabase
        .from("measurement_journal")
        .select("industrial_accident_number, invoice_email, measurement_year, measurement_period")
        .eq("code", code)
        .order("measurement_year", { ascending: false })
        .order("measurement_period", { ascending: false })
        .limit(5);

    console.log("Recent Journals Count:", recentJournals?.length);
    if (recentJournals) console.table(recentJournals);

    let journalManagerInfo: any = {};
    if (recentJournals && recentJournals.length > 0) {
        const fields = ["industrial_accident_number", "invoice_email"];
        for (const field of fields) {
            for (const journal of recentJournals) {
                if ((journal as any)[field] && !journalManagerInfo[field]) {
                    journalManagerInfo[field] = (journal as any)[field];
                    break;
                }
            }
        }
    }

    console.log("Journal Manager Info (from Recent Journals):", journalManagerInfo);

    // Final Merged Result
    const finalResult = {
        industrial_accident_number: baseBusinessData?.industrial_accident_number || prioritizedDefaults.industrial_accident_number || journalManagerInfo?.industrial_accident_number || "",
    };

    console.log(">>> FINAL RESULT:", finalResult);
}

debugData().catch(console.error);
