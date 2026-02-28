import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const VALID_CHECKBOXES = ["최초실시", "고시물질", "공정 수시변경", "소음 85 이상", "전회 미실시", "타기관 신규"];

// 실제 업데이트 여부 제어 플래그 (Dry Run)
const DRY_RUN = false;

async function main() {
    console.log(`[시작] 측정일지 비고(note) 정제 및 복구 스크립트 (DRY_RUN: ${DRY_RUN})\n`);

    const { data: journals, error: fetchError } = await supabase
        .from('measurement_journal')
        .select('id, code, note, measurement_year, measurement_period, business_name')
        .not('note', 'is', null);

    if (fetchError) {
        console.error("조회 에러:", fetchError);
        return;
    }

    let updateCount = 0;
    let recoverCount = 0;

    for (const journal of journals || []) {
        if (typeof journal.note !== 'string') continue;

        const originalNote = journal.note.trim();
        if (!originalNote) continue;

        // Step A: 콜론 포함 문자열 제거 (클리닝)
        const splitNotes = originalNote.split(',').map(n => n.trim()).filter(Boolean);
        let cleanedCheckboxes = splitNotes.filter(n => VALID_CHECKBOXES.includes(n));

        // 이 일지에서 복구된 항목을 기록할 배열
        const recoveredItems: string[] = [];

        // Step B: 유실 데이터 복구 
        // 현재 노트에 예비조사자, 공시료 등의 텍스트가 섞여 있다면 정상적인 체크박스가 밀려서 유실되었을 가능성이 있음.
        if (originalNote.includes('예비조사자') || originalNote.includes('실측정자') || originalNote.includes('보고서') || originalNote.includes('공시료') || originalNote.length >= 40) {
            const { data: pastJournals } = await supabase
                .from('measurement_journal')
                .select('note')
                .eq('code', journal.code)
                .lt('measurement_year', journal.measurement_year)
                .order('measurement_year', { ascending: false })
                .order('created_at', { ascending: false })
                .limit(3);

            if (pastJournals && pastJournals.length > 0) {
                for (const p of pastJournals) {
                    if (!p.note) continue;

                    const pastNotes = p.note.split(',').map((n: string) => n.trim());
                    const pastCheckboxes = pastNotes.filter((n: string) => VALID_CHECKBOXES.includes(n));

                    if (pastCheckboxes.length > 0) {
                        pastCheckboxes.forEach((cb: string) => {
                            if (!cleanedCheckboxes.includes(cb)) {
                                cleanedCheckboxes.push(cb);
                                recoveredItems.push(cb);
                            }
                        });
                        break;
                    }
                }
            }
        }

        // 최종 형태로 결합
        const finalNoteString = cleanedCheckboxes.length > 0 ? cleanedCheckboxes.join(',') : null;

        // 원본과 다르면 업데이트 대상으로 분류
        if (originalNote !== finalNoteString) {
            updateCount++;

            console.log(`📝 [대상 사업장] ${journal.measurement_year} ${journal.measurement_period} ${journal.business_name} (Code: ${journal.code})`);
            console.log(`   🔸 원본(${originalNote.length}자): ${originalNote}`);

            if (recoveredItems.length > 0) {
                recoverCount++;
                console.log(`   ✨ [복구됨]: ${recoveredItems.join(', ')}`);
            }

            console.log(`   ✅ 최종 저장: ${finalNoteString === null ? '(빈 값 - null)' : finalNoteString}\n`);

            if (!DRY_RUN) {
                const { error: updateError } = await supabase
                    .from('measurement_journal')
                    .update({ note: finalNoteString })
                    .eq('id', journal.id);

                if (updateError) {
                    console.error(`   ❌ [업데이트 실패] ID: ${journal.id}`, updateError);
                } else {
                    console.log(`   💾 [업데이트 성공] ID: ${journal.id}`);
                }
            }
        }
    }

    console.log(`\n=================================================`);
    console.log(`[완료] 총 ${journals?.length}건 중 ${updateCount}건 정제(변경) 대상 확인.`);
    console.log(`[복구] 버그로 인해 잘렸던 체크박스가 복구된 건수: ${recoverCount}건`);
    if (DRY_RUN) {
        console.log(`⚠️ 현재는 DRY RUN 모드이므로 실제 DB에 반영되지 않았습니다.`);
        console.log(`⚠️ 실제 반영하려면 소스의 DRY_RUN을 false로 변경하고 다시 실행하세요.`);
    } else {
        console.log(`✅ 실제 DB 반영이 완료되었습니다.`);
    }
}

main();
