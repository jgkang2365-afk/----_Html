import { createServerClient } from '../lib/db/supabase';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// .env.local의 환경 변수 로드
dotenv.config({ path: '.env.local' });

async function backupDatabase() {
    console.log('🚀 Supabase 데이터 백업을 시작합니다...');

    const supabase = createServerClient();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupDir = path.join(process.cwd(), 'backups', timestamp);

    // 백업 디렉토리 생성
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }

    // 백업 대상 테이블 목록 (마이그레이션 기반)
    const tables = [
        'measurement_business',
        'measurement_journal',
        'business_info',
        'other_revenue',
        'national_support_application',
        'measurement_target_business',
        'preliminary_survey',
        'users',
        'business_category'
    ];

    for (const table of tables) {
        try {
            console.log(`📦 테이블 백업 중: ${table}...`);

            const { data, error } = await supabase
                .from(table)
                .select('*');

            if (error) {
                // 테이블이 존재하지 않을 수도 있으므로 에러 처리
                if (error.code === '42P01') {
                    console.warn(`⚠️  테이블 존재하지 않음: ${table}`);
                    continue;
                }
                throw error;
            }

            const filePath = path.join(backupDir, `${table}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
            console.log(`✅ 백업 완료: ${table} (${data?.length || 0} rows)`);
        } catch (err) {
            console.error(`❌ ${table} 백업 중 오류 발생:`, err);
        }
    }

    // 오래된 백업 삭제 (최근 7일만 유지)
    cleanOldBackups();

    console.log(`✨ 모든 백업이 완료되었습니다! 경로: ${backupDir}`);
}

function cleanOldBackups() {
    const backupsRoot = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupsRoot)) return;

    const maxAgeDays = 7;
    const now = new Date().getTime();

    const directories = fs.readdirSync(backupsRoot);
    for (const dir of directories) {
        const dirPath = path.join(backupsRoot, dir);
        const stats = fs.statSync(dirPath);

        // 생성된 지 7일이 넘은 디렉토리 삭제
        const ageInDays = (now - stats.birthtimeMs) / (1000 * 60 * 60 * 24);
        if (ageInDays > maxAgeDays) {
            console.log(`🧹 오래된 백업 삭제 중: ${dir}`);
            fs.rmSync(dirPath, { recursive: true, force: true });
        }
    }
}

backupDatabase().catch(console.error);
