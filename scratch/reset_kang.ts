import { createClient } from "@supabase/supabase-js";
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    const name = "강종구";
    const newPassword = "adminpassword"; // 강종구 비밀번호를 adminpassword로 리셋
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(newPassword, salt);

    console.log(`강종구 비밀번호 재설정 시도 중...`);

    const { data, error } = await supabase
        .from('users')
        .update({ password_hash: hash })
        .eq('name', name);

    if (error) {
        console.error("비밀번호 재설정 에러:", error);
    } else {
        console.log(`강종구 비밀번호가 'adminpassword'로 정상 재설정되었습니다.`);
    }
}

main().catch(console.error);
