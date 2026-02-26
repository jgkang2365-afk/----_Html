
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigateMismatch() {
    const h0448Code = 'H0448';
    const uiBizNum = '305-86-41481';
    const dbBizNum = '3918802936';

    console.log(`Investigating mismatch for ${h0448Code}`);

    // 1. Check measurement_business for H0448
    const { data: mbH0448 } = await supabase.from('measurement_business').select('*').eq('code', h0448Code);
    console.log('\n--- measurement_business for H0448 ---');
    console.log(mbH0448);

    // 2. Check business_info for H0448
    const { data: biH0448 } = await supabase.from('business_info').select('*').eq('code', h0448Code);
    console.log('\n--- business_info for H0448 ---');
    console.log(biH0448);

    // 3. Search for the UI business number across tables
    const cleanUiBizNum = uiBizNum.replace(/-/g, '');

    console.log(`\nSearching for business number: ${uiBizNum} (clean: ${cleanUiBizNum})`);

    const { data: mbByNum } = await supabase.from('measurement_business').select('code, business_name, business_number').or(`business_number.eq.${uiBizNum},business_number.eq.${cleanUiBizNum}`);
    console.log('\n--- measurement_business search by UI number ---');
    console.log(mbByNum);

    const { data: biByNum } = await supabase.from('business_info').select('code, business_name, business_number').or(`business_number.eq.${uiBizNum},business_number.eq.${cleanUiBizNum}`);
    console.log('\n--- business_info search by UI number ---');
    console.log(biByNum);

    // 4. Check if there's any other record with '주식회사 태성메뉴얼서비스'
    const { data: byName } = await supabase.from('measurement_business').select('code, business_name, business_number').ilike('business_name', '%태성메뉴얼%');
    console.log('\n--- measurement_business search by Name "태성메뉴얼" ---');
    console.log(byName);
}

investigateMismatch();
