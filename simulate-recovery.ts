import { createClient } from "@supabase/supabase-js";
import * as fs from 'fs';
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// 약칭 변환 함수 (lib/constants/designated-offices.ts 에서 발췌)
function toShortName(fullName: string) {
    const map: Record<string, string> = {
        "대전지방고용노동청": "대전",
        "대전지방고용노동청 청주지청": "청주",
        "대전지방고용노동청 천안지청": "천안",
        "대전지방고용노동청 충주지청": "충주",
        "대전지방고용노동청 보령지청": "보령",
        "대전지방고용노동청 서산출장소": "서산",
    };
    return map[fullName] || fullName;
}

const DRY_RUN = false; // DB 업데이트를 실행합니다.

async function main() {
    console.log("=== 연번 정합성 검사 및 정제 스크립트 ===");

    // 1. 전체 데이터 조회 (2026년 기준, 생성일 오름차순)
    const { data, error } = await supabase
        .from('measurement_journal')
        .select('id, designated_office, measurement_year, measurement_period, total_employees, five_plus_sequence, business_name, created_at, updated_at')
        .eq('measurement_year', 2026)
        .not('sequence_number', 'is', null)
        .order('created_at', { ascending: true }); // 가장 처음 만들어진 녀석부터

    if (error || !data) {
        console.error("데이터 조회 실패", error);
        return;
    }

    console.log(`총 ${data.length}건의 데이터 조회 완료.`);

    // 2. 관리할 가상 트래커 상태 초기화
    // tracker[office_year_period] = current_max_sequence
    const tracker: Record<string, number> = {};

    const fixes = [];

    // 3. 시간순서대로 재생(Simulation)
    for (const journal of data) {
        if (!journal.designated_office || !journal.measurement_period) continue;

        const office = toShortName(journal.designated_office);
        const key = `${office}_${journal.measurement_year}_${journal.measurement_period}`;

        // 이 그룹에 처음 등장했다면 초기화
        if (tracker[key] === undefined) {
            tracker[key] = 0;
        }

        // 직원 수 체크
        const empCount = journal.total_employees ? Number(journal.total_employees) : 0;
        let expectedNumberStr = "0";

        if (empCount >= 5) {
            // 5인 이상: 새 번호 부여 (+1)
            tracker[key] += 1;
            expectedNumberStr = String(tracker[key]);
        } else {
            // 5인 미만: 직전 번호 복사 (현재 트래커의 max 값)
            // 만약 아직 한번도 5인 이상이 없었다면 "0" 유지
            if (tracker[key] > 0) {
                expectedNumberStr = String(tracker[key]);
            } else {
                expectedNumberStr = "0";
            }
        }

        // 실제 부여된 번호와 시뮬레이션 번호 비교
        const actualNumberStr = journal.five_plus_sequence;

        if (actualNumberStr !== expectedNumberStr) {
            // 불일치 발생! 이 레코드는 번호가 꼬인 상태임.
            fixes.push({
                id: journal.id,
                office: office,
                name: journal.business_name,
                actual: actualNumberStr,
                expected: expectedNumberStr,
                empCount: empCount,
                created_at: journal.created_at,
                updated_at: journal.updated_at
            });
        }
    }

    console.log(`\n불일치 (복원 대상) 레코드 총 ${fixes.length}건 발견.\n`);

    if (fixes.length === 0) {
        console.log("모든 데이터의 연번이 정상입니다.");
        return;
    }

    // 보고서 출력
    for (const fix of fixes) {
        console.log(`[${fix.office}] ${fix.name} (ID: ${fix.id})`);
        console.log(`   - 인원수: ${fix.empCount} 명`);
        console.log(`   - ❌ 현재 꼬인 번호: ${fix.actual}`);
        console.log(`   - ✅ 복원되어야 할 원래 번호: ${fix.expected}`);
        console.log('---');
    }

    // 복원 적용!
    if (!DRY_RUN) {
        console.log("\n=== 복원 작업 시작 (DB 반영) ===");
        for (const fix of fixes) {
            const { error } = await supabase
                .from('measurement_journal')
                .update({ five_plus_sequence: fix.expected })
                .eq('id', fix.id);

            if (error) {
                console.error(`ID ${fix.id} 업데이트 실패:`, error);
            } else {
                console.log(`ID ${fix.id} (${fix.name}) -> ${fix.expected} 로 복원 완료`);
            }
        }
        console.log("\n수정 완료!");
    } else {
        console.log("\n[DRY_RUN 모드] 데이터 검사만 하고 실제 DB 수정은 하지 않았습니다.");
        console.log("실제 수정을 원하시면 DRY_RUN = false 로 변경 후 실행하세요.");
    }
}

main();
