import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkUserColumns() {
    console.log("Checking columns for users table...");
    const { data: userData, error } = await supabase
        .from("users")
        .select("*")
        .limit(1);

    if (error) {
        console.error("Error fetching data from users table:", error);
        return;
    }

    if (userData && userData.length > 0) {
        console.log("Columns in users table:");
        console.log(Object.keys(userData[0]));
    } else {
        console.log("No users found to check columns. Attempting to get table definition if possible...");
        // Fallback: list columns via query if possible (using public.users might be restricted)
        console.log("Empty table.");
    }
}

checkUserColumns();
