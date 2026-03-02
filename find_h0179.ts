import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log("Searching for H0179 representative changes...");
    const { data, error } = await supabase
        .from("sync_log")
        .select("created_at, sync_type, change_details, file_name")
        .order("created_at", { ascending: false })
        .limit(100);

    if (error) {
        console.error("Error fetching logs:", error);
        return;
    }

    data?.forEach(log => {
        if (!log.change_details) return;
        const h0179Logs = log.change_details.filter((detail: string) =>
            detail.includes("H0179") && detail.includes("대표자")
        );
        if (h0179Logs.length > 0) {
            console.log(`[Time: ${log.created_at}] [File: ${log.file_name}]`);
            console.log(h0179Logs.join("\n"));
            console.log("-----------------------------------------");
        }
    });
}

main();
