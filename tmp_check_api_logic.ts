
import axios from 'axios';
import * as dotenv from 'dotenv';
import path from 'path';

// We can't easily call the API route directly via HTTP because it requires authentication (getSession).
// But we can simulate the logic in a script using the same Supabase client.
// Actually, I'll just check if there's any other business_info for H0448.

import { createClient } from '@supabase/supabase-js';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkApiLogic() {
    const code = 'H0448';
    const year = '2026';
    const period = '상반기';

    console.log(`Simulating API logic for ${code} ${year} ${period}`);

    // 1. business_info
    const { data: businessInfo } = await supabase.from("business_info").select("*").eq("code", code).maybeSingle();
    console.log('\nbusinessInfo:', businessInfo);

    // 2. allBusinessHistory
    const { data: allBusinessHistory } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("code", code)
        .order("year", { ascending: false })
        .order("period", { ascending: false });
    console.log('\nallBusinessHistory count:', allBusinessHistory?.length);

    // 3. prioritizedDefaults
    const findFirstValue = (field: string) => {
        if (!allBusinessHistory) return null;
        for (const record of allBusinessHistory) {
            if (record[field]) return record[field];
        }
        return null;
    };

    const prioritizedDefaults = {
        business_number: findFirstValue("business_number"),
        representative_name: findFirstValue("representative_name"),
        industrial_accident_number: findFirstValue("industrial_accident_number"),
    };
    console.log('\nprioritizedDefaults:', prioritizedDefaults);

    // 4. baseBusinessData
    const targetYear = parseInt(year);
    const targetPeriod = period.trim();
    const baseBusinessData = allBusinessHistory?.find(
        (b: any) => b.year === targetYear && b.period?.trim() === targetPeriod
    );
    console.log('\nbaseBusinessData:', baseBusinessData);

    // Final merge logic
    const business = {
        ...businessInfo,
        ...baseBusinessData,
        business_number: baseBusinessData?.business_number || prioritizedDefaults.business_number || businessInfo?.business_number || "",
        representative_name: baseBusinessData?.representative_name || prioritizedDefaults.representative_name || businessInfo?.representative_name || "",
    };

    console.log('\nFinal Merged Business Number:', business.business_number);
    console.log('Final Merged Representative Name:', business.representative_name);
}

checkApiLogic();
