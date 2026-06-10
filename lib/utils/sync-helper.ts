
import { SupabaseClient } from "@supabase/supabase-js";

interface SyncResult {
    code: string;
    national_support_status: string | null;
    previous_measurement_date: string | null; // YYYY-MM-DD
    previous_measurement_period: string | null;
    future_measurement_period: number | null;
    address: string | null;
    business_category: string | null;
    business_name: string | null;
    manager_name: string | null;
    manager_mobile: string | null;
    phone: string | null;
    fax: string | null;
    business_number: string | null;
    industrial_accident_number: string | null;
    office_jurisdiction: string | null;
    status: string | null; // New field for standardized status
}

/**
 * [The Joo Rule] 사업장 상태값 정규화
 * '확정' -> '실시', '미확정' -> '미실시', '종료' -> '거래종료'
 */
export function normalizeBusinessStatus(val: any): string {
    if (!val) return "미실시";
    const s = String(val).trim();
    if (s === "확정" || s === "실시" || s === "완료") return "실시";
    if (s === "미확정" || s === "미실시" || s === "대기") return "미실시";
    if (s === "종료" || s === "거래종료" || s === "거래 종료") return "거래종료";
    return s;
}

/**
 * 특정 주기 이전의 5개 주기를 역순으로 계산
 * 예: 2026 상반기 -> [2025 하, 2025 상, 2024 하, 2024 상, 2023 하]
 */
function getPreviousPeriods(year: number, period: string, count: number = 5): { year: number; period: string }[] {
    const results: { year: number; period: string }[] = [];
    let currentYear = year;
    let currentPeriod = period;

    for (let i = 0; i < count; i++) {
        if (currentPeriod === "상반기") {
            currentYear -= 1;
            currentPeriod = "하반기";
        } else {
            currentPeriod = "상반기";
        }
        results.push({ year: currentYear, period: currentPeriod });
    }

    return results;
}

/**
 * 데이터 동기화 로직
 * 주어진 코드에 대해 타 테이블의 정보를 "최신 5개 주기" 우선순위로 조회하여 채움
 */
export async function syncBusinessData(
    supabase: SupabaseClient,
    code: string,
    targetYear: number,
    targetPeriod: string,
    baseData: Partial<SyncResult> = {}
): Promise<SyncResult> {
    // 결과 초기화 (이미 입력된 값 우선)
    let result: SyncResult = {
        code,
        national_support_status: baseData.national_support_status || null,
        previous_measurement_date: baseData.previous_measurement_date || null,
        previous_measurement_period: baseData.previous_measurement_period || null,
        future_measurement_period: baseData.future_measurement_period || null,
        address: baseData.address || null,
        business_category: baseData.business_category || null,
        business_name: baseData.business_name || null,
        manager_name: baseData.manager_name || null,
        manager_mobile: baseData.manager_mobile || null,
        phone: baseData.phone || null,
        fax: baseData.fax || null,
        business_number: baseData.business_number || null,
        industrial_accident_number: baseData.industrial_accident_number || null,
        office_jurisdiction: baseData.office_jurisdiction || null,
        status: normalizeBusinessStatus(baseData.status),
    };

    // 1. 필요한 필드가 모두 채워져 있으면 바로 리턴 (최적화)
    // 단, 여기서는 business_info 등에서 최신 정보를 가져오는 것이 목적이므로
    // '강제 업데이트'가 아닌 이상 빈 값(null)인 경우만 채우는 정책을 따름.
    // (하지만 PRD 4.1에 따르면 모든 연동 대상에 대해 우선순위 규칙 적용)

    // 2. 과거 5개 주기 계산
    const periods = getPreviousPeriods(targetYear, targetPeriod);

    // 3. 국고지원 결과 (national_support_application) - 해당 년도/주기
    if (!result.national_support_status) {
        const { data } = await supabase
            .from("national_support_application")
            .select("national_support_status")
            .eq("code", code)
            .eq("year", targetYear)
            .eq("period", targetPeriod)
            .single();

        if (data?.national_support_status) {
            result.national_support_status = data.national_support_status;
        }
    }

    // 4. 전회 측정일/주기 및 업종 (measurement_journal) - 과거 5개 주기 역순 탐색
    // 이미 값이 있어도 '전회' 정보를 정확히 가져오기 위해 조회 필요할 수 있음
    // 하지만 여기서는 '값이 없는 경우'를 우선으로 함.
    let journalCategory: string | null = null;
    if (!result.previous_measurement_date || !result.business_category) {
        // 한 번의 쿼리로 5개 주기 데이터를 모두 가져와서 정렬
        const { data: journals } = await supabase
            .from("measurement_journal")
            .select("measurement_year, measurement_period, measurement_end_date, measurement_start_date, business_category")
            .eq("code", code)
            .in("measurement_year", periods.map(p => p.year))
            .not("measurement_end_date", "is", null) // 날짜가 있는 것만
            .order("measurement_year", { ascending: false })
            .order("measurement_period", { ascending: false }); // 문자열 정렬이라 "하반기" > "상반기" (운 좋게 맞음)

        // 로직상 정확한 역순 정렬을 위해 JS에서 처리 권장
        if (journals && journals.length > 0) {
            // periods 순서대로 매칭되는 첫 번째 찾기
            for (let i = 0; i < periods.length; i++) {
                const p = periods[i];
                const match = journals.find((j: any) => j.measurement_year === p.year && j.measurement_period === p.period);
                if (match) {
                    if (!result.previous_measurement_date) {
                        result.previous_measurement_date = match.measurement_end_date || match.measurement_start_date;
                        result.previous_measurement_period = match.measurement_period; // "상반기" or "하반기"
                    }
                    // 2순위: 최근 3주기 이내의 일지 데이터에서 업종 추출
                    if (i < 3 && !journalCategory && match.business_category) {
                        journalCategory = match.business_category;
                    }
                    if (result.previous_measurement_date && journalCategory) break;
                }
            }
        }
    }

    // 4.5. [1순위] 측정 대상 사업장 정보 (measurement_target_business) - 업종 분류 기초 데이터
    const { data: targetData } = await supabase
        .from("measurement_target_business")
        .select("business_category")
        .eq("code", code)
        .eq("year", targetYear)
        .eq("period", targetPeriod)
        .single();

    // 5. 기본 정보 (business_info) - 최신 1건
    const { data: bInfo } = await supabase
        .from("business_info")
        .select("address1, address2, phone, fax, manager_name, business_category, office_jurisdiction, business_number, industrial_accident_number")
        .eq("code", code)
        .single();

    // 6. 측정 사업장 정보 (measurement_business) - 최신 1건 (혹은 해당 주기)
    // measurement_business는 '계획' 성격이 있으므로 해당 주기의 데이터가 있다면 그게 우선일 수 있음.
    // 여기서는 '최신' 정보를 가져오기 위해 역순 정렬
    const { data: mbData } = await supabase
        .from("measurement_business")
        .select("business_name, address, manager_name, manager_mobile, business_category, future_measurement_period, industrial_accident_number, business_number, fax")
        .eq("code", code)
        .order("year", { ascending: false }) // 최신 년도
        .order("period", { ascending: false })
        .limit(1)
        .single();

    // 값 채우기 (우선순위: measurement_business -> business_info -> null)

    if (!result.business_name && mbData?.business_name) result.business_name = mbData.business_name;
    // business_info에는 business_name이 보통 없거나 매핑 안됨 (스키마 확인 필요하나 일반적으로 code 매핑)

    if (!result.address) {
        if (mbData?.address) result.address = mbData.address;
        else if (bInfo) {
            const parts = [bInfo.address1, bInfo.address2].filter(Boolean);
            if (parts.length > 0) result.address = parts.join(" ");
        }
    }

    if (!result.business_category) {
        // 1순위: measurement_target_business
        if (targetData?.business_category) {
            result.business_category = targetData.business_category;
        } 
        // 2순위: measurement_journal (직전 3주기)
        else if (journalCategory) {
            result.business_category = journalCategory;
        }
        // 1, 2순위가 없으면 무조건 null (하위 호환성 로직 삭제)
    }

    if (!result.manager_name) {
        if (mbData?.manager_name) result.manager_name = mbData.manager_name;
        else if (bInfo?.manager_name) result.manager_name = bInfo.manager_name;
    }

    if (!result.manager_mobile && mbData?.manager_mobile) {
        result.manager_mobile = mbData.manager_mobile;
    }

    if (!result.phone && bInfo?.phone) {
        result.phone = bInfo.phone;
    }

    if (!result.fax) {
        if (mbData?.fax) result.fax = mbData.fax;
        else if (bInfo?.fax) result.fax = bInfo.fax;
    }

    if (!result.business_number) {
        if (mbData?.business_number) result.business_number = mbData.business_number;
        else if (bInfo?.business_number) result.business_number = bInfo.business_number;
    }

    if (!result.industrial_accident_number) {
        if (mbData?.industrial_accident_number) result.industrial_accident_number = mbData.industrial_accident_number;
        else if (bInfo?.industrial_accident_number) result.industrial_accident_number = bInfo.industrial_accident_number;
    }

    if (!result.office_jurisdiction) {
        // 1순위: business_info
        if (bInfo?.office_jurisdiction) result.office_jurisdiction = bInfo.office_jurisdiction;
        // 2순위: 주소 기반 추론 (생략 - 필요 시 추가)
    }

    if (!result.future_measurement_period && mbData?.future_measurement_period) {
        result.future_measurement_period = mbData.future_measurement_period;
    }

    return result;
}
