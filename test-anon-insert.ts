import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function testAnonInsert() {
    console.log("Attempting insert with ANON KEY...");
    const { data, error } = await supabase
        .from("users")
        .insert({
            name: "anon_test_" + Date.now(),
            role: "사용자",
            job: "측정"
        });

    if (error) {
        console.error("ANON INSERT FAILED!");
        console.error("Error Code:", error.code);
        console.error("Error Message:", error.message);
    } else {
        console.log("ANON INSERT SUCCESS!");
    }
}

testAnonInsert();
