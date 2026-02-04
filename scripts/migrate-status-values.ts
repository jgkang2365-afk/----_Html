
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Supabase URL or Key is missing!");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function migrateStatusValues() {
    console.log("Migration Start: Updating is_registered values in measurement_target_business...");

    // 1. Update '미실시' -> '미확정'
    const { data: data1, error: error1, count: count1 } = await supabase
        .from("measurement_target_business")
        .update({ is_registered: "미확정" })
        .eq("is_registered", "미실시")
        .select("id", { count: 'exact' });

    if (error1) {
        console.error("Error migrating '미실시' -> '미확정':", error1);
    } else {
        console.log(`Successfully migrated '미실시' -> '미확정': ${count1} rows (or ${data1?.length} affected).`);
    }

    // 2. Update '실시' -> '확정'
    const { data: data2, error: error2, count: count2 } = await supabase
        .from("measurement_target_business")
        .update({ is_registered: "확정" })
        .eq("is_registered", "실시")
        .select("id", { count: 'exact' });

    if (error2) {
        console.error("Error migrating '실시' -> '확정':", error2);
    } else {
        console.log(`Successfully migrated '실시' -> '확정': ${count2} rows (or ${data2?.length} affected).`);
    }

    console.log("Migration Complete.");
}

migrateStatusValues();
