
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

const adminName = process.env.INIT_ADMIN_USERNAME;
const adminPassword = process.env.INIT_ADMIN_PASSWORD;
const testName = process.env.INIT_TEST_USERNAME;
const testPassword = process.env.INIT_TEST_PASSWORD;

if (!adminName || !adminPassword || !testName || !testPassword) {
    throw new Error("INIT_USER_CREDENTIALS_MISSING");
}

if (adminPassword.length < 12 || testPassword.length < 12) {
    throw new Error("INIT_USER_PASSWORDS_MUST_BE_AT_LEAST_12_CHARACTERS");
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function initUsers() {
    const salt = await bcrypt.genSalt(10);

    // 1. 관리자 계정 생성
    const adminHash = await bcrypt.hash(adminPassword, salt);

    console.log(`사용자 초기화 진행 중: ${adminName}...`);

    const { error: adminError } = await supabase
        .from('users')
        .upsert({
            name: adminName,
            password_hash: adminHash,
            role: '관리자',
            job: '측정'
        }, { onConflict: 'name' });

    if (adminError) {
        console.error(`사용자 초기화 실패 (${adminName}):`, adminError);
    } else {
        console.log(`사용자 초기화 성공: ${adminName}`);
    }

    // 2. 테스트 계정 생성
    const testHash = await bcrypt.hash(testPassword, salt);

    console.log(`사용자 초기화 진행 중: ${testName}...`);

    const { error: testError } = await supabase
        .from('users')
        .upsert({
            name: testName,
            password_hash: testHash,
            role: '관리자',
            job: '측정'
        }, { onConflict: 'name' });

    if (testError) {
        console.error(`사용자 초기화 실패 (${testName}):`, testError);
    } else {
        console.log(`사용자 초기화 성공: ${testName}`);
    }
}

initUsers();
