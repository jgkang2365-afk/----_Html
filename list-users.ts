
import { createClient } from "./lib/supabase/server";

async function listUsers() {
    const supabase = await createClient();
    const { data, error } = await supabase.from("users").select("*");
    if (error) {
        console.error(error);
    } else {
        console.log(JSON.stringify(data, null, 2));
    }
}

listUsers();
