import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkSchema() {
    console.log("Fetching detailed schema for users table...");

    const { data, error } = await supabase.rpc('get_table_info', { t_name: 'users' });

    if (error) {
        console.log("RPC get_table_info failed (expected if not defined). Falling back to direct query...");

        const { data: schemaData, error: schemaError } = await supabase
            .from("users")
            .select("*")
            .limit(0); // Only get metadata if possible

        if (schemaError) {
            console.error("Error fetching users metadata:", schemaError);
            return;
        }

        console.log("Direct query worked, but metadata is limited.");
    } else {
        console.table(data);
    }

    // Attempting to use information_schema via RPC if possible
    // Alternatively, just try to insert a row with missing fields and see the exact error
}

async function testConstraints() {
    console.log("\n--- Testing Constraints ---");
    const testCases = [
        { name: "Constraint Test 1", role: "사용자" }, // Missing everything else
    ];

    for (const test of testCases) {
        console.log(`Testing insert: ${JSON.stringify(test)}`);
        const { error } = await supabase.from("users").insert(test);
        if (error) {
            console.error("Insert Failed as expected or unexpected:", error.message);
            console.log("Details:", error.details);
        } else {
            console.log("Insert Succeeded! (Constraint is lax)");
        }
    }
}

checkSchema().then(() => testConstraints());
