
import { createAdminClient } from "@/lib/supabase/admin";
import { SupabaseClient } from "@supabase/supabase-js";
import { VerificationIssue } from "./excel-sync";

/**
 * 데이터 정합성 검증 함수
 * Docs/Business_Logic_Rules.md 에 정의된 규칙에 따라
 * business_info 와 measurement_business 간의 불일치를 검사하고
 * data_verification_issues 테이블에 저장합니다.
 */

// 날짜 포맷 함수 (YYYY/MM/DD)
function formatDate(dateString: string | null | undefined): string {
    if (!dateString) return "";
    try {
        const date = new Date(dateString);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `_${year}/${month}/${day}`;
    } catch (e) {
        return "";
    }
}


// 두 문자열을 비교하여 차이점을 [[ ]] 로 감싸는 함수
function highlightDiff(str1: string, str2: string): [string, string] {
    if (!str1 || !str2) return [str1 || "", str2 || ""];

    // 1. 길이가 같으면 문자 단위 비교
    if (str1.length === str2.length) {
        let res1 = "";
        let res2 = "";
        for (let i = 0; i < str1.length; i++) {
            if (str1[i] !== str2[i]) {
                res1 += `[[${str1[i]}]]`;
                res2 += `[[${str2[i]}]]`;
            } else {
                res1 += str1[i];
                res2 += str2[i];
            }
        }
        return [res1, res2];
    }

    // 2. 길이가 다르면... (복잡한 Diff 알고리즘 대신, 간단히 전체를 강조하거나, 앞부분 일치만 확인)
    // 여기서는 간단히 전체를 강조하는 대신, 그냥 원본을 반환하되,
    // 길이가 다른 경우에는 "다른 부분"을 정확히 집어내기 어려우므로(Shift 발생), 
    // 그냥 통째로 [[ ]] 를 씌우는게 나을 수도 있지만, 너무 지저분해실 수 있음.
    // 사용자 요청 예시는 길이 같은 경우였음.
    // 길이가 다르면 식별이 쉬우므로 하이라이팅을 하지 않거나, 다른 방식으로 처리.
    // 여기서는 '단순 비교'를 위해 앞에서부터 일치하지 않는 부분부터 끝까지 하이라이팅 처리 (약식)
    let minLen = Math.min(str1.length, str2.length);
    let diffStart = -1;
    for (let i = 0; i < minLen; i++) {
        if (str1[i] !== str2[i]) {
            diffStart = i;
            break;
        }
    }

    if (diffStart === -1) {
        // 한쪽이 다른쪽의 부분집합인 경우 (길이만 다름)
        diffStart = minLen;
    }

    const res1 = str1.substring(0, diffStart) + `[[${str1.substring(diffStart)}]]`;
    const res2 = str2.substring(0, diffStart) + `[[${str2.substring(diffStart)}]]`;

    // 빈 괄호가 생기면 제거 (ex: "Test" vs "Test2" -> Test[[]] vs Test[[2]])
    return [
        res1.replace("[[]]", ""),
        res2.replace("[[]]", "")
    ];
}

export async function verifyDataConsistency(externalSupabaseClient?: SupabaseClient<any, "public", any>) {
    const supabase = externalSupabaseClient || createAdminClient();
    const issues: VerificationIssue[] = [];

    try {
        console.log("[Verification] 데이터 정합성 검증 시작...");

        // 1. 모든 business_info 조회
        const { data: businessInfos, error: bError } = await supabase
            .from("business_info")
            .select("code, business_name, representative_name, updated_at");

        if (bError) throw new Error(`business_info 조회 실패: ${bError.message}`);

        // 최적화: Map으로 변환하여 조회 속도 향상
        const businessInfoMap = new Map<string, any>();
        businessInfos?.forEach(b => {
            if (b.code) businessInfoMap.set(b.code, b);
        });

        // 2. 모든 measurement_business 조회
        const { data: measurements, error: mError } = await supabase
            .from("measurement_business")
            .select("code, business_name, representative_name, year, period, created_at")
            .gte('year', 2024) // 최신 3년치만 조회하여 성능 최적화 (필요시 조정)
            .order("year", { ascending: false });

        if (mError) throw new Error(`measurement_business 조회 실패: ${mError.message}`);

        // 3. measurement_business 데이터를 코드별로 그룹화하고 "최신 자료" 선정
        const latestMeasurementMap = new Map<string, any>();

        measurements?.forEach((m) => {
            if (!latestMeasurementMap.has(m.code)) {
                latestMeasurementMap.set(m.code, m);
            } else {
                const existing = latestMeasurementMap.get(m.code);

                // 년도 비교
                if (m.year > existing.year) {
                    latestMeasurementMap.set(m.code, m);
                } else if (m.year === existing.year) {
                    // 주기 비교 로직: 하반기 > 상반기
                    const getPeriodScore = (p: string) => {
                        if (!p) return 0;
                        return (p.includes("하반기") || p.includes("4분기") || p.includes("3분기") || p.includes("2")) ? 2 : 1;
                    };

                    if (getPeriodScore(m.period) > getPeriodScore(existing.period)) {
                        latestMeasurementMap.set(m.code, m);
                    }
                }
            }
        });

        console.log(`[Verification] 검증 대상: business_info(${businessInfoMap.size}건), measurement_business(최신 ${latestMeasurementMap.size}건)`);

        // 4. 비교 로직 수행
        // 기준: measurement_business (최신) vs business_info (현재)
        // measurement_business 에 있는 코드는 반드시 business_info 에도 있어야 하며, 정보가 일치해야 함.

        for (const [code, latest] of latestMeasurementMap.entries()) {
            const current = businessInfoMap.get(code);
            const businessName = latest.business_name || "";

            // [규칙] "번외"가 포함된 사업장은 검증 대상에서 제외
            if (businessName.includes("번외")) {
                continue;
            }

            if (!current) {
                // Case 1: 측정사업장에는 있는데 사업장정보에 없는 경우 (Missing)
                // H로 시작하는 코드만 검증 (테스트 데이터 제외)
                if (code.startsWith('H')) {
                    issues.push({
                        code,
                        business_name: latest.business_name,
                        issue_type: 'MISSING_IN_BUSINESS_INFO',
                        description: `측정사업장(최신)(measurement_business)에는 존재하지만 사업장 정보(business_info)에는 없는 사업장입니다. (기준: ${latest.year}년 ${latest.period})`
                    });
                }
            } else {
                // Case 2: 정보 불일치 (Mismatch)
                // 사업장명 비교 (공백 제거 후 비교)
                const latestName = (latest.business_name || "").replace(/\s+/g, "").trim();
                const currentName = (current.business_name || "").replace(/\s+/g, "").trim();

                if (latestName && latestName !== currentName) {
                    const [hLatest, hCurrent] = highlightDiff(latest.business_name || "", current.business_name || "");

                    issues.push({
                        code,
                        business_name: current.business_name || latest.business_name, // 표시용 이름
                        issue_type: 'MISMATCH_NAME',
                        description: `사업장명 불일치: 측정사업장(최신)(measurement_business)${formatDate(latest.created_at)}(${hLatest}) vs 사업장 정보(business_info)${formatDate(current.updated_at)}(${hCurrent}) (날짜: 데이터 생성/수정일)`
                    });
                }

                // 대표자명 비교
                const latestRep = (latest.representative_name || "").replace(/\s+/g, "").trim();
                const currentRep = (current.representative_name || "").replace(/\s+/g, "").trim();

                // 둘 다 값이 있는 경우에만 비교 (한쪽만 비어있는 경우는 불일치로 보지 않음 - 정책에 따라 다름, 여기선 보수적으로)
                if (latestRep && currentRep && latestRep !== currentRep) {
                    const [hLatest, hCurrent] = highlightDiff(latest.representative_name || "", current.representative_name || "");

                    issues.push({
                        code,
                        business_name: current.business_name || latest.business_name,
                        issue_type: 'MISMATCH_REPRESENTATIVE',
                        description: `대표자명 불일치: 측정사업장(최신)(measurement_business)${formatDate(latest.created_at)}(${hLatest}) vs 사업장 정보(business_info)${formatDate(current.updated_at)}(${hCurrent}) (날짜: 데이터 생성/수정일)`
                    });
                }
            }
        }

        console.log(`[Verification] 총 ${issues.length}개의 이슈 발견.`);

        // 5. 측정일지 특이사항(special_notes)에 불일치 내역 반영
        await syncIssuesToJournalRemarks(supabase, issues);

        // 6. DB 갱신
        // 기존 이슈 모두 삭제
        const { error: deleteError } = await supabase
            .from("data_verification_issues")
            .delete()
            .neq("id", 0);

        if (deleteError) {
            console.error("[Verification] 기존 이슈 삭제 실패:", deleteError);
        }

        if (issues.length > 0) {
            // 배치 Insert (최대 1000개씩 분할)
            const batchSize = 1000;
            for (let i = 0; i < issues.length; i += batchSize) {
                const batch = issues.slice(i, i + batchSize);
                const { error: insertError } = await supabase
                    .from("data_verification_issues")
                    .insert(batch.map(item => ({
                        code: item.code,
                        business_name: item.business_name,
                        issue_type: item.issue_type,
                        description: item.description
                    })));

                if (insertError) console.error(`[Verification] 이슈 등록 실패 (Batch ${i}):`, insertError);
            }
        }

        return { success: true, issueCount: issues.length };

    } catch (error) {
        console.error("[Verification] 검증 중 오류 발생:", error);
        return { success: false, error: error };
    }
}

/**
 * 불일치 내역을 measurement_journal의 special_notes에 반영하는 함수
 */
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
            const currentNotes = journal.special_notes || "";
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
        // 기존 이슈 DB 조회
        const { data: previousIssues } = await supabase.from("data_verification_issues").select("code");
        const previousCodes = new Set(previousIssues?.map((i: any) => i.code) || []);

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
