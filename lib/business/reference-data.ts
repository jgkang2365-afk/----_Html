import { SupabaseClient } from "@supabase/supabase-js";

export interface ReferenceData {
    business_name?: string;
    business_number?: string;
    address?: string;
    manager_name?: string;
    manager_position?: string;
    manager_mobile?: string;
    manager_email?: string;
    phone?: string;
    fax?: string;
    total_employees?: number;
    business_category?: string;
    national_support_status?: string;
    industrial_accident_number?: string;
    commencement_number?: string;
    invoice_email?: string;
    invoice_email_2?: string;
    representative_name?: string;
    source_type?: 'exact' | 'latest_history' | 'business_info' | 'none';
    source_desc?: string;
}

/**
 * 측정일지 데이터 보정을 위한 "최적의 참조 데이터"를 조회합니다.
 * 필드별 우선순위 요건 반영:
 * 1. 국고지원, 업종분류: measurement_target_business (계획) 우선
 * 2. 담당자 정보, 계산서 정보: measurement_business (Excel 동기화 데이터) 우선
 */
export async function getBestReferenceData(
    supabase: SupabaseClient,
    code: string,
    year: number,
    period: string,
    options?: { excludeCurrent?: boolean }
): Promise<ReferenceData> {
    if (!code) return { source_type: 'none' };

    // 1. 측정 대상 사업장 (계획 테이블) 조회
    // 현재 주기 제외 옵션이 켜져 있으면 계획 테이블 조회도 건너뜁니다 (계획은 항상 해당 주기용이므로)
    const targetMatch = !options?.excludeCurrent 
        ? (await supabase
            .from("measurement_target_business")
            .select("*")
            .eq("code", code)
            .eq("year", year)
            .eq("period", period)
            .maybeSingle()).data
        : null;

    // 2. 측정사업장 (Master) 조회 - 현재 주기 데이터 우선, 없으면 최신 이력 조회
    let masterData = null;
    let masterSourceDesc = "";
    
    // 2-a. 현재 주기 데이터 조회
    let exactMatch = null;
    if (!options?.excludeCurrent) {
        const { data } = await supabase
            .from("measurement_business")
            .select("*")
            .eq("code", code)
            .eq("year", year)
            .eq("period", period)
            .maybeSingle();
        exactMatch = data;
    }

    if (exactMatch) {
        masterData = exactMatch;
        masterSourceDesc = `${year}년 ${period} (Master)`;
    } else {
        // 2-b. 최신 주기의 데이터 조회 (1개만)
        let query = supabase
            .from("measurement_business")
            .select("*")
            .eq("code", code);
        
        // 현재 주기 제외 옵션이 있으면 필터 추가
        if (options?.excludeCurrent) {
            query = query.or(`year.neq.${year},period.neq.${period}`);
        }

        const { data: latestHistory } = await query
            .order("year", { ascending: false })
            .order("period", { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (latestHistory) {
            masterData = latestHistory;
            masterSourceDesc = `${latestHistory.year}년 ${latestHistory.period} (이력)`;
        }
    }

    // 2-c. [2순위용] 최근 3주기 이력에서 업종 분류 조회 (Target에 없을 경우를 대비)
    let journalCategory: string | null = null;
    const { data: recentJournals } = await supabase
        .from("measurement_journal")
        .select("business_category, measurement_year, measurement_period")
        .eq("code", code)
        .order("measurement_year", { ascending: false })
        .order("measurement_period", { ascending: false })
        .limit(3);
    
    if (recentJournals && recentJournals.length > 0) {
        // 유효한 첫 번째 업종 분류를 찾음
        const match = recentJournals.find(j => j.business_category);
        if (match) journalCategory = match.business_category;
    }

    // 3. 데이터 병합 (계획 + 마스터)
    if (targetMatch || masterData) {
        const target = targetMatch ? mapTargetBusinessToRef(targetMatch) : {};
        const master = masterData ? mapMeasurementBusinessToRef(masterData) : {};
        
        const mergedData: any = {};

        // A. 계획 테이블이 권위 있는 필드 (국고지원, 업종분류)
        mergedData.national_support_status = target.national_support_status || master.national_support_status;
        
        // 업종분류 우선순위: 1. Target -> 2. Journal(3주기) -> 3. null (Master 차단)
        mergedData.business_category = target.business_category || journalCategory || null;

        // B. 측정사업장(Master)이 권위 있는 필드 (담당자, 계산서 정보, 개시번호, 총인원 등)
        mergedData.manager_name = master.manager_name || target.manager_name;
        mergedData.manager_position = master.manager_position || target.manager_position;
        mergedData.manager_mobile = master.manager_mobile || target.manager_mobile;
        mergedData.manager_email = master.manager_email || target.manager_email;
        mergedData.invoice_email = master.invoice_email || target.invoice_email;
        mergedData.invoice_email_2 = master.invoice_email_2 || target.invoice_email_2;
        mergedData.total_employees = master.total_employees ?? target.total_employees;
        mergedData.commencement_number = master.commencement_number || target.commencement_number;
        mergedData.industrial_accident_number = master.industrial_accident_number || target.industrial_accident_number;

        // C. 기타 공통 정보 (Master 우선, 없으면 계획)
        mergedData.business_name = master.business_name || target.business_name;
        mergedData.business_number = master.business_number || target.business_number;
        mergedData.address = master.address || target.address;
        mergedData.phone = master.phone || target.phone;
        mergedData.fax = master.fax || target.fax;
        mergedData.representative_name = master.representative_name || target.representative_name;

        return {
            ...mergedData,
            source_type: exactMatch ? 'exact' : (masterData ? 'latest_history' : 'none'),
            source_desc: masterSourceDesc || (targetMatch ? `측정대상(${year} ${period})` : "")
        };
    }

    // 4. 사업장정보 (기본 마스터)
    const { data: businessInfo } = await supabase
        .from("business_info")
        .select("*")
        .eq("code", code)
        .maybeSingle();

    if (businessInfo) {
        return {
            ...mapBusinessInfoToRef(businessInfo),
            source_type: 'business_info',
            source_desc: '사업장정보'
        };
    }

    return { source_type: 'none' };
}

function mapTargetBusinessToRef(data: any): ReferenceData {
    return {
        business_name: data.business_name,
        business_number: data.business_number,
        address: data.address,
        manager_name: data.manager_name,
        manager_position: data.manager_position, // 계획 테이블에 있다면 매핑
        manager_mobile: normalizePhoneLikeValue(data.manager_mobile, data.manager_name),
        phone: data.manager_phone, 
        total_employees: data.total_employees,
        business_category: data.business_category,
        national_support_status: data.national_support_status,
        industrial_accident_number: data.industrial_accident_number,
        commencement_number: data.commencement_number,
        representative_name: data.representative_name,
    };
}

function mapMeasurementBusinessToRef(data: any): ReferenceData {
    const total_employees = data.total_employees !== null && data.total_employees !== undefined
        ? (typeof data.total_employees === 'string' ? parseInt(data.total_employees.replace(/,/g, "")) : data.total_employees)
        : null;

    return {
        business_name: data.business_name,
        business_number: data.business_number,
        address: data.address,
        manager_name: data.manager_name,
        manager_position: data.manager_position,
        manager_mobile: normalizePhoneLikeValue(data.manager_mobile, data.manager_name),
        manager_email: data.manager_email,
        total_employees: isNaN(total_employees) ? null : total_employees,
        business_category: data.business_category,
        national_support_status: data.national_support_status,
        industrial_accident_number: data.industrial_accident_number,
        commencement_number: data.commencement_number,
        invoice_email: data.invoice_email,
        invoice_email_2: data.invoice_email_2,
        representative_name: data.representative_name,
        phone: data.phone,
        fax: data.fax,
    };
}

function mapBusinessInfoToRef(data: any): ReferenceData {
    const address = [data.address1, data.address2].filter(Boolean).join(" ").trim();
    return {
        business_name: data.business_name,
        business_number: data.business_number,
        address: address,
        manager_name: data.manager_name,
        manager_position: data.manager_position,
        phone: data.phone,
        fax: data.fax,
        total_employees: data.total_employees,
        commencement_number: data.commencement_number,
        invoice_email: data.invoice_email,
        representative_name: data.representative_name,
    };
}

function normalizePhoneLikeValue(value: any, managerName?: any): string | undefined {
    const text = String(value || "").trim();
    if (!text) return undefined;

    const nameText = String(managerName || "").trim();
    const digitCount = (text.match(/\d/g) || []).length;
    const containsKorean = /[가-힣]/.test(text);

    if (nameText && text === nameText) return undefined;
    if (containsKorean && digitCount < 7) return undefined;
    if (digitCount > 0 && digitCount < 7) return undefined;

    return text;
}

