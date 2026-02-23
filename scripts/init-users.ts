
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env.local");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function initUsers() {
    const name = "admin";
    const password = "adminpassword"; // 초기 비밀번호, 나중에 변경 권장
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);

    console.log(`Initializing user: ${name}...`);

    const { data, error } = await supabase
        .from('users')
        .upsert({
            name: name,
            password_hash: hash,
            role: '관리자',
            job: '측정'
        }, { onConflict: 'name' })
        .select();

    if (error) {
        console.error("Error initializing user:", error);
    } else {
        console.log(`User initialized successfully: ${name}`);
    }
}

initUsers();
