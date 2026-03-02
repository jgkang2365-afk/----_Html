import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('id, code, business_name, five_plus_sequence, updated_at')
        .gt('updated_at', '2026-02-28T00:00:00+00:00')
        .order('updated_at', { ascending: false });

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('--- RECENT UPDATES AFTER FEB 28 ---');
    data?.forEach(item => {
        const date = new Date(item.updated_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
        console.log(`[${date}] Code:${item.code} | Name:${item.business_name} | Seq:${item.five_plus_sequence}`);
    });
}
check();
