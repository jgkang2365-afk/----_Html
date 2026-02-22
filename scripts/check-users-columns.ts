import { createClient } from "../lib/supabase/server";

async function checkColumns() {
    const supabase = await createClient();
    const { data, error } = await supabase
        .from("users")
        .select("*")
        .limit(1);

    if (error) {
        console.error("Error fetching users:", error);
        return;
    }

    if (data && data.length > 0) {
        console.log("Columns in 'users' table:", Object.keys(data[0]));
    } else {
        console.log("No data in 'users' table to check columns.");
    }
}

checkColumns();
