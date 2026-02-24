const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkReportWriters() {
    const { data: surveyData, error: surveyError } = await supabase
        .from('preliminary_survey')
        .select('report_writer, preliminary_surveyor')
        .limit(1000);

    if (surveyError) {
        console.error(surveyError);
        return;
    }

    const writers = [...new Set(surveyData.flatMap(d => (d.report_writer || '').split(',').map(s => s.trim())).filter(Boolean))];
    console.log('Report Writers:', JSON.stringify(writers));

    const surveyors = [...new Set(surveyData.flatMap(d => (d.preliminary_surveyor || '').split(',').map(s => s.trim())).filter(Boolean))];
    console.log('Surveyors:', JSON.stringify(surveyors));
}

checkReportWriters();
