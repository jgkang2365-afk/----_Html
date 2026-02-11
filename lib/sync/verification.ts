
import { createClient } from "@/lib/supabase/server";
import { SupabaseClient } from "@supabase/supabase-js";

export interface VerificationIssue {
    code: string;
    business_name: string;
    issue_type: 'MISMATCH_NAME' | 'MISMATCH_REPRESENTATIVE' | 'MISSING_IN_BUSINESS_INFO' | 'MISSING_IN_MEASUREMENT';
    description: string;
}

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

export async function verifyDataConsistency(externalSupabaseClient?: SupabaseClient<any, "public", any>) {
    const supabase = externalSupabaseClient || await createClient();
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
                        description: `MES DB에는 존재하지만 측정일지 관리 웹에는 없는 사업장입니다. (기준: ${latest.year}년 ${latest.period})`
                    });
                }
            } else {
                // Case 2: 정보 불일치 (Mismatch)
                // 사업장명 비교 (공백 제거 후 비교)
                const latestName = (latest.business_name || "").replace(/\s+/g, "").trim();
                const currentName = (current.business_name || "").replace(/\s+/g, "").trim();

                if (latestName && latestName !== currentName) {
                    issues.push({
                        code,
                        business_name: current.business_name || latest.business_name, // 표시용 이름
                        issue_type: 'MISMATCH_NAME',
                        description: `사업장명 불일치: MES DB${formatDate(latest.created_at)}(${latest.business_name}) vs 측정일지 관리 웹${formatDate(current.updated_at)}(${current.business_name})`
                    });
                }

                // 대표자명 비교
                const latestRep = (latest.representative_name || "").replace(/\s+/g, "").trim();
                const currentRep = (current.representative_name || "").replace(/\s+/g, "").trim();

                // 둘 다 값이 있는 경우에만 비교 (한쪽만 비어있는 경우는 불일치로 보지 않음 - 정책에 따라 다름, 여기선 보수적으로)
                if (latestRep && currentRep && latestRep !== currentRep) {
                    issues.push({
                        code,
                        business_name: current.business_name || latest.business_name,
                        issue_type: 'MISMATCH_REPRESENTATIVE',
                        description: `대표자명 불일치: MES DB${formatDate(latest.created_at)}(${latest.representative_name}) vs 측정일지 관리 웹${formatDate(current.updated_at)}(${current.representative_name})`
                    });
                }
            }
        }

        console.log(`[Verification] 총 ${issues.length}개의 이슈 발견.`);

        // 5. DB 갱신
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
