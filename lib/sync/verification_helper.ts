/**
 * 불일치 내역을 measurement_journal의 special_notes에 반영하는 함수
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { VerificationIssue } from './excel-sync';

async function syncIssuesToJournalRemarks(supabase: SupabaseClient, issues: VerificationIssue[]) {
    try {
        console.log("[Verification] 측정일지 특이사항 동기화 시작...");

        // 1. 현재 존재하는 모든 이슈 코드 수집
        const activeIssueCodes = new Set(issues.map(i => i.code));

        // 2. 이슈가 있는 사업장 처리 (Update/Append)
        // 각 이슈별로 최신 측정일지를 찾아서 업데이트
        for (const issue of issues) {
            // 해당 사업장의 최신 측정일지 조회 (올해 기준)
            const { data: journals, error: jError } = await supabase
                .from("measurement_journal")
                .select("id, special_notes, measurement_year")
                .eq("code", issue.code)
                .order("measurement_year", { ascending: false })
                .order("id", { ascending: false }) // 같은 연도면 최신 ID
                .limit(1);

            if (jError || !journals || journals.length === 0) continue;

            const journal = journals[0];
            let currentNotes = journal.special_notes || "";
            const issueNote = `[데이터 불일치] ${issue.description}`;

            // 이미 동일한 불일치 내용이 있는지 확인
            if (!currentNotes.includes(issueNote)) {
                // 기존의 [데이터 불일치] 태그가 있다면 제거하고 새로 추가 (내용 갱신)
                const noteLines = currentNotes.split('\n');
                const filteredLines = noteLines.filter((line: string) => !line.startsWith('[데이터 불일치]'));

                // 새 불일치 내용 추가 (가장 윗줄에)
                filteredLines.unshift(issueNote);

                const newNotes = filteredLines.join('\n');

                await supabase
                    .from("measurement_journal")
                    .update({ special_notes: newNotes, updated_at: new Date().toISOString() })
                    .eq("id", journal.id);
            }
        }

        // 3. 이슈가 해소된 사업장 처리 (Remove)
        // 측정일지 중 [데이터 불일치] 태그가 있는데, 현재 이슈 목록에는 없는 코드 찾기
        // (이 부분은 성능 이슈로 인해, "최신 측정일지" 기준으로만 체크하거나, 
        //  별도로 "이전에 이슈가 있었던 코드"를 추적해야 완벽하지만, 
        //  여기서는 "최근 업데이트된 저널" 중 불일치 태그가 있는 것을 검색하는 방식으로 약식 구현하거나
        //  전체 스캔이 부담스러우므로, 이번 실행 주기에 포함된 이슈 외에
        //  "기존에 이슈가 있었던" 코드를 data_verification_issues 테이블에서 미리 가져왔어야 함.
        //  하지만 data_verification_issues 테이블을 지우기 전에 이 함수를 호출하므로, 
        //  "지워질 예정인 이슈"를 알 수 있음.)

        // 로직 수정: 
        // 1) DB에 저장된 기존 이슈들을 먼저 조회 (함수 인자로 받거나 여기서 조회)
        // 2) 기존 이슈에는 있었으나, 현재 issues(새로 발견된 이슈)에는 없는 코드 식별 => "해소된 이슈"

        // * verifyDataConsistency 함수 내에서 data_verification_issues 테이블을 지우기 전이므로, 
        //   현재 DB에 있는게 "이전 상태"임.
        const { data: previousIssues } = await supabase.from("data_verification_issues").select("code");
        const previousCodes = new Set(previousIssues?.map(i => i.code) || []);

        // 해소된 코드 = (이전 코드) - (현재 발견된 코드)
        const resolvedCodes = [...previousCodes].filter(code => !activeIssueCodes.has(code));

        if (resolvedCodes.length > 0) {
            console.log(`[Verification] 해소된 이슈 ${resolvedCodes.length}건 처리를 시작합니다.`);

            for (const code of resolvedCodes) {
                const { data: journals } = await supabase
                    .from("measurement_journal")
                    .select("id, special_notes")
                    .eq("code", code)
                    .order("measurement_year", { ascending: false })
                    .limit(1);

                if (journals && journals.length > 0) {
                    const journal = journals[0];
                    if (journal.special_notes && journal.special_notes.includes('[데이터 불일치]')) {
                        const noteLines = journal.special_notes.split('\n');
                        const filteredLines = noteLines.filter((line: string) => !line.startsWith('[데이터 불일치]'));
                        const newNotes = filteredLines.join('\n');

                        await supabase
                            .from("measurement_journal")
                            .update({ special_notes: newNotes, updated_at: new Date().toISOString() })
                            .eq("id", journal.id);
                    }
                }
            }
        }

    } catch (e) {
        console.error("[Verification] 특이사항 동기화 실패:", e);
    }
}
