const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkJobs() {
    try {
        const { data: jobs, error } = await supabase
            .from('background_jobs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) {
            console.error('Error fetching jobs:', error);
            return;
        }

        console.log('--- Recent 20 Background Jobs ---');
        jobs.forEach(job => {
            console.log(`[${job.created_at}] ID: ${job.id} | Type: ${job.job_type} | Status: ${job.status} | Err: ${job.error_message}`);
        });
    } catch (e) {
        console.error('Execution error:', e);
    }
}

checkJobs();
