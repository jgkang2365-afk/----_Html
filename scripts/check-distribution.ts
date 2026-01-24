import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function checkCounts() {
    // Check distribution of years in measurement_business
    const { data: businessData } = await supabase
        .from("measurement_business")
        .select("year");

    if (businessData) {
        const counts = businessData.reduce((acc: any, curr) => {
            acc[curr.year] = (acc[curr.year] || 0) + 1;
            return acc;
        }, {});
        console.log("measurement_business years:", counts);
    }

    // Check plan_based_year in target
    const { data: targetData } = await supabase
        .from("measurement_target_business")
        .select("year, plan_based_year");

    if (targetData) {
        const counts = targetData.reduce((acc: any, curr) => {
            const key = `${curr.year}_${curr.plan_based_year}`;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        console.log("measurement_target_business year_planYear:", counts);
    }

    // Check 2025 measurement_business data sample
    const { data: sample2025 } = await supabase
        .from("measurement_business")
        .select("code, business_name, year, period, business_category, manager_name")
        .eq("year", 2025)
        .limit(3);

    console.log("Sample 2025 data:", JSON.stringify(sample2025, null, 2));
}

checkCounts();
