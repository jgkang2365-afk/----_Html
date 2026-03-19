import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function simulateApi() {
  const code = 'H0220';
  const year = '2026';
  const period = '상반기';

  // 1. business_info
  const { data: businessInfo } = await supabase.from("business_info").select("*").eq("code", code).maybeSingle();
  
  // 2. history
  const { data: allBusinessHistory } = await supabase
    .from("measurement_business")
    .select("*")
    .eq("code", code)
    .order("year", { ascending: false })
    .order("period", { ascending: false });

  const findFirstValue = (field) => {
    if (!allBusinessHistory) return null;
    for (const record of allBusinessHistory) {
      if (record[field]) return record[field];
    }
    return null;
  };

  const prioritizedDefaults = {
    business_category: findFirstValue("business_category"),
  };

  let business = {
    ...businessInfo,
    business_category: prioritizedDefaults.business_category || businessInfo?.business_category || "",
  };

  // 4. target
  const { data: targetData } = await supabase
    .from("measurement_target_business")
    .select("business_category")
    .eq("code", code)
    .eq("year", parseInt(year))
    .eq("period", period)
    .maybeSingle();

  if (targetData?.business_category) {
    business.business_category = targetData.business_category;
  }

  console.log('Final API Simulator Result (business_category):', business.business_category);
}

simulateApi();
