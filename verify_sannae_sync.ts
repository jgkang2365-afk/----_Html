import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { syncBusinessToCalendar } from "./lib/google/sync-service";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verifySync() {
    const code = "H0058"; // 산내모터스
    const year = 2026;
    const period = "상반기";

    console.log(`Manually triggering sync for ${code}...`);
    try {
        const result = await syncBusinessToCalendar(supabase, code, year, period);
        console.log("Sync result:", result ? "Success" : "No action / Failed");
    } catch (e) {
        console.error("Sync error:", e);
    }
}

verifySync();
