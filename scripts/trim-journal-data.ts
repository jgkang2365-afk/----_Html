/**
 * 데이터 정제 스크립트: measurement_journal 테이블의 공백(whitespace) 제거
 * 실행: npx tsx scripts/trim-journal-data.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
import { createClient } from "@supabase/supabase-js";

// .env.local 파일 로드
config({ path: resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// 데이터 수정을 위해 SERVICE_ROLE_KEY 사용 권장, 없으면 UPDATE 정책 허용된 ANON_KEY 시도
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error("환경 변수가 설정되지 않았습니다.");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function trimJournalData() {
    console.log("데이터 정제 시작: 공백 제거 중...\n");

    try {
        // 모든 데이터 조회
        const { data: allJournals, error } = await supabase
            .from('measurement_journal')
            .select('id, measurement_period, designated_office, office_jurisdiction, code');

        if (error) {
            console.error("데이터 조회 실패:", error);
            return;
        }

        console.log(`총 ${allJournals.length}개 데이터 검사 시작`);

        let updatedCount = 0;
        const updates = [];

        for (const journal of allJournals) {
            let needsUpdate = false;
            const updateData: any = {};

            // 1. measurement_period Trim
            if (journal.measurement_period && journal.measurement_period !== journal.measurement_period.trim()) {
                updateData.measurement_period = journal.measurement_period.trim();
                needsUpdate = true;
                console.log(`[수정] ${journal.code}: measurement_period "${journal.measurement_period}" -> "${updateData.measurement_period}"`);
            }

            // 2. designated_office Trim
            if (journal.designated_office && journal.designated_office !== journal.designated_office.trim()) {
                updateData.designated_office = journal.designated_office.trim();
                needsUpdate = true;
                console.log(`[수정] ${journal.code}: designated_office "${journal.designated_office}" -> "${updateData.designated_office}"`);
            }

            // 3. office_jurisdiction Trim
            if (journal.office_jurisdiction && journal.office_jurisdiction !== journal.office_jurisdiction.trim()) {
                updateData.office_jurisdiction = journal.office_jurisdiction.trim();
                needsUpdate = true;
                console.log(`[수정] ${journal.code}: office_jurisdiction "${journal.office_jurisdiction}" -> "${updateData.office_jurisdiction}"`);
            }

            if (needsUpdate) {
                updates.push(
                    supabase.from('measurement_journal').update(updateData).eq('id', journal.id)
                );
                updatedCount++;
            }
        }

        if (updatedCount > 0) {
            console.log(`\n총 ${updatedCount}개 데이터 업데이트 진행 중...`);
            await Promise.all(updates);
            console.log("업데이트 완료!");
        } else {
            console.log("\n수정이 필요한 데이터가 없습니다.");
        }

    } catch (err) {
        console.error("스크립트 실행 중 오류:", err);
    }
}

trimJournalData().catch(console.error);
