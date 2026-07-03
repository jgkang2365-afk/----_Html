
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
    const salt = await bcrypt.genSalt(10);

    // 1. 기존 admin 계정 생성
    const adminName = "admin";
    const adminPassword = "adminpassword"; // 초기 비밀번호, 나중에 변경 권장
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

    // 2. 테스트용 test 계정 생성
    const testName = "test";
    const testPassword = "@0000@"; // 사용자 요청 테스트 비밀번호
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
