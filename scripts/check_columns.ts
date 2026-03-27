import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkColumns() {
    const { data, error } = await supabase
        .from("measurement_target_business")
        .select("*")
        .limit(1)
        .single();

    if (error) {
        console.error("Error:", error);
    } else {
        console.log("Columns found:", Object.keys(data));
    }
}

checkColumns();
