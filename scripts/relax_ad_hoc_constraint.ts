
import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Construct connection string (Direct connection)
// If DATABASE_URL is not present, we can't connect directly via PG.
// But Supabase projects typically provide DATABASE_URL.
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error('❌ DATABASE_URL is missing in .env.local');
    process.exit(1);
}

async function runMigration() {
    console.log('🚀 Starting Partial Index Migration...');
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false } // Required for Supabase
    });

    try {
        await client.connect();
        console.log('✅ Connected to Database');

        // 1. Drop existing unique constraint
        try {
            console.log('Step 1: Dropping constraint "measurement_target_business_code_year_period_key"...');
            await client.query('ALTER TABLE measurement_target_business DROP CONSTRAINT measurement_target_business_code_year_period_key;');
            console.log('✅ Constraint dropped.');
        } catch (e: any) {
            console.warn('⚠️  Warning dropping constraint (maybe already dropped):', e.message);
        }

        // 2. Create partial unique index
        // This ensures uniqueness for Regular periods (NOT like '%(수시)%')
        // but allows duplicates for Ad-hoc periods.
        try {
            console.log('Step 2: Creating Partial Unique Index...');
            await client.query(`
                CREATE UNIQUE INDEX measurement_target_business_code_year_period_unique_idx
                ON measurement_target_business (code, year, period)
                WHERE period NOT LIKE '%(수시)%';
            `);
            console.log('✅ Partial Unique Index created.');
        } catch (e: any) {
            if (e.message.includes('already exists')) {
                console.log('✅ Index already exists.');
            } else {
                throw e;
            }
        }

        console.log('🎉 Migration successful! You can now register multiple Ad-hoc entries.');

    } catch (err) {
        console.error('❌ Migration Failed:', err);
    } finally {
        await client.end();
    }
}

runMigration();
