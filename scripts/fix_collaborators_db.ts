import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
    console.log("Applying collaborators column migration...");
    
    const sql = "ALTER TABLE measurement_target_business ADD COLUMN IF NOT EXISTS collaborators TEXT;";
    
    // Try different RPC variants found in the codebase
    const rpcVariants = [
        { name: "exec_sql", arg: "sql_query" },
        { name: "exec_sql", arg: "sql" }
    ];

    let success = false;
    for (const variant of rpcVariants) {
        console.log(`Trying RPC: ${variant.name} with ${variant.arg}...`);
        try {
            const { data, error } = await supabase.rpc(variant.name, { [variant.arg]: sql });
            if (error) {
                console.error(`- Error: ${error.message} (${error.code})`);
            } else {
                console.log(`- RPC Call seems to have succeeded. Response:`, data);
                success = true;
                break;
            }
        } catch (e) {
            console.error(`- Exception:`, e);
        }
    }

    // Verify
    console.log("\nVerifying column existence...");
    const { data: testData, error: testError } = await supabase
        .from("measurement_target_business")
        .select("*")
        .limit(1);

    if (testError) {
        console.error("Verification error:", testError);
    } else if (testData && testData.length > 0) {
        const hasCol = 'collaborators' in testData[0];
        console.log(`Column 'collaborators' exists: ${hasCol}`);
        if (!hasCol && !success) {
            console.log("\n!!! CRITICAL: Column creation failed and RPCs failed.");
            console.log("Please run the following SQL in Supabase SQL Editor manually:");
            console.log(sql);
        }
    } else {
        console.log("No data found to verify columns.");
    }
}

applyMigration();
