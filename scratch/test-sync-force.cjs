const { createClient } = require("@supabase/supabase-js");
const fs = require('fs');
const path = require('path');

// dotenv manually load for CJS
const envContent = fs.readFileSync('.env.local', 'utf8');
envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        process.env[match[1]] = val;
    }
});

const { syncBusinessToCalendar } = require("./lib/google/sync-service");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
    try {
        console.log("Starting sync test for H0260...");
        const result = await syncBusinessToCalendar(supabase, "H0260", 2026, "상반기");
        console.log("Success!", result);
    } catch (e) {
        console.error("Test Failed:", e);
    }
}

run();
