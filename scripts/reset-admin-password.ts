
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import {
    assertSupabaseEnvironment,
    SUPABASE_PROJECT_REFS,
} from '../lib/supabase/environment-guard';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

assertSupabaseEnvironment({
    appEnvironment: process.env.NEXT_PUBLIC_APP_ENV,
    databaseUrl: supabaseUrl,
    productionProjectRef: SUPABASE_PROJECT_REFS.production,
    stagingProjectRef: SUPABASE_PROJECT_REFS.staging,
});

const adminName = process.env.RESET_ADMIN_USERNAME;
const newPassword = process.env.RESET_ADMIN_PASSWORD;
if (!adminName || !newPassword || newPassword.length < 12) {
    throw new Error('RESET_ADMIN_CREDENTIALS_MISSING_OR_WEAK');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetAdminPassword() {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    console.log(`Resetting password for configured admin user...`);

    const { data, error } = await supabase
        .from('users')
        .update({ password_hash: hash })
        .eq('name', adminName);

    if (error) {
        console.error("Error resetting password:", error);
    } else {
        console.log('Configured admin password has been reset successfully.');
    }
}

resetAdminPassword();
