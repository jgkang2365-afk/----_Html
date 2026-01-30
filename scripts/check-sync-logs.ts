
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSyncLogs() {
    console.log("Checking recent sync logs for errors...");

    const { data: logs, error } = await supabase
        .from("sync_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(10);

    if (error) {
        console.error("Error fetching sync logs:", error);
        return;
    }

    console.log(`Found ${logs.length} log entries.`);

    logs.forEach((log) => {
        console.log(`\n[${new Date(log.created_at).toLocaleString()}] File: ${log.file_name} (${log.sync_type}) - Status: ${log.status}`);
        if (log.error_message) {
            console.log(`  Error: ${log.error_message}`);
        }
    });
}

checkSyncLogs();
