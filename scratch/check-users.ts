import { createClient } from "../lib/supabase/server";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function checkUsers() {
    const supabase = await createClient();
    const { data: users } = await supabase.from('users').select('*');
    console.log("=== DB Users 목록 ===");
    console.log(users);
}

checkUsers();
