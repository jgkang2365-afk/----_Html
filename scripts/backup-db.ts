import { createServerClient } from '../lib/db/supabase';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// .env.local의 환경 변수 로드
dotenv.config({ path: '.env.local' });

export async function backupDatabase() {
    console.log('🚀 Supabase 데이터 백업을 시작합니다...');

    const supabase = createServerClient();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    
    let backupDir = '';
    let backupRoot = '';
    const envBackupRoot = process.env.BACKUP_STORAGE_ROOT;

    // 백업 디렉토리 경로 결정 (지정 경로 실패 시 로컬 Fallback)
    if (envBackupRoot) {
        try {
            backupRoot = path.isAbsolute(envBackupRoot) ? envBackupRoot : path.join(process.cwd(), envBackupRoot);
            backupDir = path.join(backupRoot, timestamp);
            
            // 디렉토리 생성 테스트 (쓰기 권한 검증용)
            fs.mkdirSync(backupDir, { recursive: true });
            console.log(`📂 지정된 백업 저장 경로를 사용합니다: ${backupDir}`);
        } catch (err: any) {
            console.warn(`⚠️  지정된 백업 경로(${envBackupRoot})에 폴더를 생성할 수 없습니다. 로컬 백업으로 대체합니다. 사유:`, err.message);
            backupRoot = path.join(process.cwd(), 'backups');
            backupDir = path.join(backupRoot, timestamp);
            fs.mkdirSync(backupDir, { recursive: true });
        }
    } else {
        backupRoot = path.join(process.cwd(), 'backups');
        backupDir = path.join(backupRoot, timestamp);
        fs.mkdirSync(backupDir, { recursive: true });
        console.log(`📂 환경변수 BACKUP_STORAGE_ROOT가 설정되지 않아 로컬 백업 경로를 사용합니다: ${backupDir}`);
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
    cleanOldBackups(backupRoot);

    console.log(`✨ 모든 백업이 완료되었습니다! 경로: ${backupDir}`);
}

function cleanOldBackups(backupsRoot: string) {
    if (!fs.existsSync(backupsRoot)) return;

    const maxAgeDays = 7;
    const now = new Date().getTime();

    const directories = fs.readdirSync(backupsRoot);
    for (const dir of directories) {
        const dirPath = path.join(backupsRoot, dir);
        
        try {
            const stats = fs.statSync(dirPath);
            // 생성된 지 7일이 넘은 디렉토리 삭제
            const ageInDays = (now - stats.birthtimeMs) / (1000 * 60 * 60 * 24);
            if (ageInDays > maxAgeDays) {
                console.log(`🧹 오래된 백업 삭제 중: ${dir}`);
                fs.rmSync(dirPath, { recursive: true, force: true });
            }
        } catch (err: any) {
            console.error(`❌ 백업 정리 중 오류 발생 (${dir}):`, err.message);
        }
    }
}

// 직접 실행 시에만 자동 실행되도록 처리 (require.main 확인)
if (require.main === module) {
    backupDatabase().catch(console.error);
}
