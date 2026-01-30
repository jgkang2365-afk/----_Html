
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyH0437() {
    const targetCode = 'H0437';
    console.log(`Checking data for code: ${targetCode}...`);

    // 1. Check business_info
    console.log("\n1. Checking business_info table:");
    const { data: businessInfo, error: businessInfoError } = await supabase
        .from('business_info')
        .select('*')
        .eq('code', targetCode);

    if (businessInfoError) {
        console.error("Error checking business_info:", businessInfoError);
    } else {
        console.log(`Found ${businessInfo?.length || 0} records.`);
        if (businessInfo && businessInfo.length > 0) {
            console.log(businessInfo[0]);
        }
    }

    // 2. Check measurement_business (The "Plan" or "Target" table)
    console.log("\n2. Checking measurement_business table:");
    const { data: measurementBusiness, error: mbError } = await supabase
        .from('measurement_business')
        .select('*')
        .eq('code', targetCode);

    if (mbError) {
        console.error("Error checking measurement_business:", mbError);
    } else {
        console.log(`Found ${measurementBusiness?.length || 0} records.`);
        if (measurementBusiness && measurementBusiness.length > 0) {
            console.table(measurementBusiness.map(b => ({
                code: b.code,
                year: b.year,
                period: b.period,
                business_name: b.business_name
            })));
        }
    }

    // 3. Check measurement_target_business (The synchronized Plan table)
    console.log("\n3. Checking measurement_target_business table:");
    const { data: targetBusiness, error: targetError } = await supabase
        .from('measurement_target_business')
        .select('*')
        .eq('code', targetCode);

    if (targetError) {
        console.error("Error checking measurement_target_business:", targetError);
    } else {
        console.log(`Found ${targetBusiness?.length || 0} records.`);
        if (targetBusiness && targetBusiness.length > 0) {
            console.table(targetBusiness.map(b => ({
                code: b.code,
                year: b.year,
                period: b.period,
                business_name: b.business_name
            })));
        }
    }
}

verifyH0437();
