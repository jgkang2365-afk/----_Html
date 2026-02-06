
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function debugQueryRepro() {
    console.log('Reproducing "assignFivePlusSequenceNumber" Query...');

    const designatedOffice = "천안";
    const measurementYear = 2026;
    const measurementPeriod = "상반기"; // strict string

    const officesToMatch = [designatedOffice]; // ["천안"]

    console.log(`Query Params: Office=[${officesToMatch.join(', ')}], Year=${measurementYear}, Period=[${measurementPeriod}]`);

    const { data: journals, error } = await supabase
        .from("measurement_journal")
        .select("id, business_name, five_plus_sequence, created_at, designated_office, measurement_period")
        .in("designated_office", officesToMatch)
        .eq("measurement_year", measurementYear)
        .eq("measurement_period", measurementPeriod)
        .not("five_plus_sequence", "is", null);

    if (error) {
        console.error("Query Error:", error);
        return;
    }

    console.log(`\nFound ${journals.length} records.`);

    // Apply Sort logic from code
    const sorted = journals
        .map(j => ({ ...j, num: parseInt(j.five_plus_sequence, 10) }))
        .filter(j => !isNaN(j.num))
        .sort((a, b) => b.num - a.num);

    console.log("Top 5 Results after Sort (Descending):");
    sorted.slice(0, 5).forEach(j => {
        console.log(`- Seq: ${j.five_plus_sequence} (Num: ${j.num}) | ${j.business_name} | Created: ${j.created_at}`);
    });

    const h0239 = journals.find(j => j.business_name.includes('아산모터스') || j.five_plus_sequence == '10');
    if (h0239) {
        console.log("\n[CONFIRMED] H0239 (Seq 10) IS in the result set.");
        console.log(`Details: Office=[${h0239.designated_office}], Period=[${h0239.measurement_period}]`);
    } else {
        console.log("\n[MISSING] H0239 (Seq 10) is NOT in the result set!");
    }
}

debugQueryRepro();
