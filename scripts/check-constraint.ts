import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function checkConstraint() {
    // get constraint definition
    const { data, error } = await supabase.rpc('get_constraint_def', { table_name: 'measurement_business', constraint_name: 'measurement_business_period_check' });
    // Since I can't easily call internal pg functions via simple RPC if not set up, I'll try to insert a dummy invalid value and see the specific error or just infer.

    // Actually, I'll inspect the constraint via specific query on information_schema if possible, but simpler is just to assume it requires '상반기' or '하반기'.

    console.log("Checking what values are allowed...");
    // Just try to insert 'Test' and see error
    const { error: err } = await supabase.from('measurement_business').insert({
        code: 'TEST_CONSTRAINT',
        year: 2026,
        period: 'Test', // Invalid
        business_name: 'Test'
    });

    if (err) {
        console.log("Insert 'Test' failed:", err.message);
    } else {
        console.log("Insert 'Test' succeeded (Constraint might be loose)");
        // cleanup
        await supabase.from('measurement_business').delete().eq('code', 'TEST_CONSTRAINT');
    }
}

checkConstraint();
