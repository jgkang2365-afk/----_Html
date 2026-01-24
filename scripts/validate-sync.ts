import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase URL or Key is missing!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function validateSync() {
    // 1. measurement_business 카운트
    const { count: sourceCount, error: sourceError } = await supabase
        .from("measurement_business")
        .select("*", { count: 'exact', head: true })
        .eq("year", 2026);

    // 2. measurement_target_business 카운트 (by year)
    const { count: targetYearCount, error: targetYearError } = await supabase
        .from("measurement_target_business")
        .select("*", { count: 'exact', head: true })
        .eq("year", 2026);

    // 2b. measurement_target_business 카운트 (by plan_based_year)
    const { count: targetPlanYearCount } = await supabase
        .from("measurement_target_business")
        .select("*", { count: 'exact', head: true })
        .eq("plan_based_year", 2026);

    const output = {
        measurement_business_2026: sourceCount,
        measurement_target_business_2026_by_year: targetYearCount,
        measurement_target_business_2026_by_plan_year: targetPlanYearCount,
    };
    console.log("VALIDATION_RESULT:", JSON.stringify(output));
}

validateSync();
