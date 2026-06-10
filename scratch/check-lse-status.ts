
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import path from "path";

// .env.local 파일 로드
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function checkStatus() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        console.error('Supabase env vars missing');
        return;
    }

    const supabase = createSupabaseClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('business_name, k2b_status, k2b_send_date')
        .ilike('business_name', '%엘에스이%')
        .order('measurement_year', { ascending: false })
        .order('measurement_period', { ascending: false })
        .limit(1);

    if (error) {
        console.error('Error fetching status:', error);
        return;
    }

    console.log('Status for 주식회사 엘에스이:', JSON.stringify(data, null, 2));
}

checkStatus();
