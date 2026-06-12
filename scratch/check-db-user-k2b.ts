import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '../lib/supabase/server';

async function checkUsers() {
    try {
        const supabase = await createClient();
        const { data: users, error } = await supabase
            .from('users')
            .select('id, name, email, k2b_id, k2b_pw');
            
        if (error) {
            console.error('유저 조회 오류:', error.message);
            return;
        }

        console.log('--- [DB] users 테이블에 등록된 계정 정보 ---');
        if (users && users.length > 0) {
            users.forEach(u => {
                console.log(`이름: ${u.name} | 이메일: ${u.email} | K2B_ID: [${u.k2b_id || '없음'}] | K2B_PW 존재여부: ${u.k2b_pw ? '있음' : '없음'}`);
            });
        } else {
            console.log('등록된 유저가 없습니다.');
        }
        
        console.log('\n--- [Env] .env.local 환경 변수 정보 ---');
        console.log(`K2B_ID (process.env.K2B_ID): [${process.env.K2B_ID || '없음'}]`);
        console.log(`K2B_PW 존재여부: ${process.env.K2B_PW ? '있음' : '없음'}`);
    } catch (e: any) {
        console.error('실행 중 오류 발생:', e.message);
    }
}

checkUsers();
