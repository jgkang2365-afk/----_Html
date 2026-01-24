
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase URL or Key is missing!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);


async function checkMeasurerData() {
    console.log("Checking distinct measurers...");
    const { data: years, error: yearError } = await supabase
        .from("measurement_target_business")
        .select("year");

    if (yearError) {
        console.error("Error fetching years:", yearError);
        return;
    }
    const yearCounts = years.reduce((acc: any, curr: any) => {
        acc[curr.year] = (acc[curr.year] || 0) + 1;
        return acc;
    }, {});
    const targetYear = Object.keys(yearCounts).sort().pop();

    if (!targetYear) { console.log("No data."); return; }
    console.log(`Target Year: ${targetYear}`);

    console.log("\n--- measurement_target_business (Plan) ---");
    const { data: targetData, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("plan_manager")
        .eq("year", targetYear);

    if (targetError) { console.error(targetError); }
    else {
        const targetCounts = targetData.reduce((acc: any, curr: any) => {
            const name = curr.plan_manager || "NULL";
            acc[name] = (acc[name] || 0) + 1;
            return acc;
        }, {});
        console.log("Plan Manager Counts:", JSON.stringify(targetCounts, null, 2));
    }

    console.log("\n--- measurement_business (Source Excel) ---");
    const { data: sourceData, error: sourceError } = await supabase
        .from("measurement_business")
        .select("measurer")
        .eq("year", targetYear);

    if (sourceError) { console.error(sourceError); }
    else {
        const sourceCounts = sourceData.reduce((acc: any, curr: any) => {
            const name = curr.measurer || "NULL";
            acc[name] = (acc[name] || 0) + 1;
            return acc;
        }, {});
        console.log("Measurer Counts:", JSON.stringify(sourceCounts, null, 2));
    }
}

checkMeasurerData();
