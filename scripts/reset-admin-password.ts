
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetAdminPassword() {
    const name = "admin";
    const newPassword = "adminpassword"; // 초기 비밀번호로 재설정
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    console.log(`Resetting password for user: ${name}...`);

    const { data, error } = await supabase
        .from('users')
        .update({ password_hash: hash })
        .eq('name', name);

    if (error) {
        console.error("Error resetting password:", error);
    } else {
        console.log(`Password for ${name} has been reset successfully to: ${newPassword}`);
    }
}

resetAdminPassword();
