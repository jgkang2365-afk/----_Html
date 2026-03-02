import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const { data: files } = await supabase.storage
        .from("excel-files")
        .list("business-info", {
            limit: 100,
            offset: 0,
        });

    const biz_info = files?.find(f => f.name === 'business_info.xlsx' || f.name === '사업장정보.xlsx');
    console.log("Found:", biz_info);
}

main();
