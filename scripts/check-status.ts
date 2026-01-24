import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function checkStatus() {
    // 1. Journal Count
    const { count, error } = await supabase
        .from("measurement_journal")
        .select("*", { count: "exact", head: true })
        .eq("measurement_year", 2026);

    console.log(`[Status] 2026 Journal Count: ${count} (Error: ${error?.message})`);

    // 2. Journal Content Sample
    const { data: journals } = await supabase
        .from("measurement_journal")
        .select("id, code, business_name, created_at")
        .eq("measurement_year", 2026)
        .limit(5);

    console.log("[Status] 2026 Journals:", journals);

    // 3. Sync Log
    const { data: logs } = await supabase
        .from("sync_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);

    console.log("[Status] Last 5 Sync Logs:", logs?.map(l => `${l.created_at}: ${l.sync_type} (${l.status})`));
}

checkStatus();
