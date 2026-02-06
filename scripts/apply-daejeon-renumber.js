
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function applyRenumbering() {
    console.log('APPLYING Daejeon 2026 Re-serialization to Database...');

    const { data: journals, error } = await supabase
        .from('measurement_journal')
        .select('id, code, business_name, five_plus_sequence, measurement_period, total_employees, created_at, designated_office')
        .eq('measurement_year', 2026)
        .in('designated_office', ['대전', '대전청'])
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error fetching data:', error);
        return;
    }

    if (!journals || journals.length === 0) {
        console.log('No data found for Daejeon 2026.');
        return;
    }

    let currentMax = 0;
    let updateCount = 0;

    for (const j of journals) {
        const oldSeq = parseInt(j.five_plus_sequence || '0', 10);
        const empCount = j.total_employees || 0;

        let newSeq = 0;

        if (empCount >= 5) {
            // 5인 이상: 새 번호 부여 (MAX + 1)
            currentMax++;
            newSeq = currentMax;
        } else {
            // 5인 미만: 직전 번호 재사용 (MAX)
            if (currentMax === 0) {
                currentMax = 1;
            }
            newSeq = currentMax;
        }

        if (oldSeq !== newSeq) {
            console.log(`Updating ${j.business_name} (${j.code}): ${oldSeq} -> ${newSeq}`);

            const { error: updateError } = await supabase
                .from('measurement_journal')
                .update({ five_plus_sequence: String(newSeq) })
                .eq('id', j.id);

            if (updateError) {
                console.error(`FAILED to update ${j.code}:`, updateError);
            } else {
                updateCount++;
            }
        } else {
            // console.log(`Skipping ${j.business_name} (${j.code}): ${oldSeq} matches`);
        }
    }

    console.log('---------------------------------------------------');
    console.log(`Renumbering Complete. Updated ${updateCount} records.`);
}

applyRenumbering();
