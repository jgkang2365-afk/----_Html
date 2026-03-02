import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log("Fetching files in business-info...");
    const { data, error } = await supabase.storage
        .from("excel-files")
        .list("business-info", {
            limit: 10,
            offset: 0,
            sortBy: { column: "created_at", order: "desc" },
        });

    if (error) {
        console.error("Error fetching files:", error);
        return;
    }

    console.log("Recent files in business-info:");
    console.log(JSON.stringify(data, null, 2));
}

main();
