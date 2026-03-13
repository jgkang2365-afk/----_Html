import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkNotificationsTable() {
    console.log("Checking notifications table...");
    const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .limit(1);

    if (error) {
        console.error("Error accessing notifications table:", error.message);
        if (error.code === '42P01') {
            console.log("Verdict: notifications table does not exist.");
        }
    } else {
        console.log("notifications table exists.");
    }
}

checkNotificationsTable();
