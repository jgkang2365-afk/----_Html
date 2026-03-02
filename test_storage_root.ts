import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data: rootFiles } = await supabase.storage.from("excel-files").list("", { limit: 20 });
    const { data: bizFiles } = await supabase.storage.from("excel-files").list("business-info", { limit: 20 });

    console.log("Root files:");
    console.log(rootFiles?.map(f => f.name));

    console.log("\nBusiness-info files:");
    console.log(bizFiles?.map(f => f.name));
}

main();
