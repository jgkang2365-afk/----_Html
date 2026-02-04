
const { createClient } = require("@supabase/supabase-js");
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase URL or Key is missing!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrateStatusValues() {
    console.log("--- MIGRATION START ---");

    const { count: totalCount } = await supabase
        .from("measurement_target_business")
        .select("*", { count: 'exact', head: true });
    console.log(`Total rows in measurement_target_business: ${totalCount}`);

    // Check counts before
    const { count: countBefore } = await supabase
        .from("measurement_target_business")
        .select("*", { count: 'exact', head: true })
        .eq("is_registered", "미실시");

    console.log(`Current '미실시' count: ${countBefore}`);

    if (countBefore > 0) {
        // 1. Update '미실시' -> '미확정'
        const { data: data1, error: error1 } = await supabase
            .from("measurement_target_business")
            .update({ is_registered: "미확정" })
            .eq("is_registered", "미실시")
            .select();

        if (error1) {
            console.error("Error migrating '미실시' -> '미확정':", error1);
        } else {
            console.log(`Successfully migrated '미실시' -> '미확정': ${data1 ? data1.length : 0} rows.`);
        }
    } else {
        console.log("No '미실시' rows to migrate.");
    }

    // Check '실시' count
    const { count: countSilshi } = await supabase
        .from("measurement_target_business")
        .select("*", { count: 'exact', head: true })
        .eq("is_registered", "실시");

    console.log(`Current '실시' count: ${countSilshi}`);

    if (countSilshi > 0) {
        // 2. Update '실시' -> '확정'
        const { data: data2, error: error2 } = await supabase
            .from("measurement_target_business")
            .update({ is_registered: "확정" })
            .eq("is_registered", "실시")
            .select();

        if (error2) {
            console.error("Error migrating '실시' -> '확정':", error2);
        } else {
            console.log(`Successfully migrated '실시' -> '확정': ${data2 ? data2.length : 0} rows.`);
        }
    } else {
        console.log("No '실시' rows to migrate.");
    }

    console.log("--- MIGRATION COMPLETE ---");
}

migrateStatusValues();
