
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
    period: string
): Promise<ReferenceData> {
    if (!code) return { source_type: 'none' };

    // 1. 측정 대상 사업장 (계획 테이블) 조회
    const { data: targetMatch } = await supabase
        .from("measurement_target_business")
        .select("*")
        .eq("code", code)
        .eq("year", year)
        .eq("period", period)
        .maybeSingle();

    // 2. 측정사업장 (Excel 동기화 마스터 테이블) 조회
    const { data: exactMatch } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("code", code)
        .eq("year", year)
        .eq("period", period)
        .maybeSingle();

    if (targetMatch || exactMatch) {
        const target = targetMatch ? mapTargetBusinessToRef(targetMatch) : {};
        const exact = exactMatch ? mapMeasurementBusinessToRef(exactMatch) : {};
        
        // [필수 로직] 필드별 권위(Authority)에 따른 병합
        const mergedData: any = {};

        // A. 계획 테이블이 권위 있는 필드 (국고지원, 업종분류)
        mergedData.national_support_status = target.national_support_status || exact.national_support_status;
        mergedData.business_category = target.business_category || exact.business_category;

        // B. 측정사업장(Excel)이 권위 있는 필드 (담당자, 계산서 정보 등)
        mergedData.manager_name = exact.manager_name || target.manager_name;
        mergedData.manager_position = exact.manager_position || target.manager_position;
        mergedData.manager_mobile = exact.manager_mobile || target.manager_mobile;
        mergedData.manager_email = exact.manager_email || target.manager_email;
        mergedData.invoice_email = exact.invoice_email || target.invoice_email;
        mergedData.invoice_email_2 = exact.invoice_email_2 || target.invoice_email_2;

        // C. 기타 공통 정보 (Excel 우선, 없으면 계획)
        mergedData.business_name = exact.business_name || target.business_name;
        mergedData.business_number = exact.business_number || target.business_number;
        mergedData.address = exact.address || target.address;
        mergedData.phone = exact.phone || target.phone;
        mergedData.total_employees = exact.total_employees ?? target.total_employees;
        mergedData.industrial_accident_number = exact.industrial_accident_number || target.industrial_accident_number;
        mergedData.commencement_number = exact.commencement_number || target.commencement_number;
        mergedData.representative_name = exact.representative_name || target.representative_name;

        return {
            ...mergedData,
            source_type: 'exact',
            source_desc: targetMatch ? `측정대상(${year} ${period})` : `${year}년 ${period}`
        };
    }

    // 3. 측정사업장 (최신 이력) - 최근 10건 중 가장 최신
    const { data: history } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("code", code)
        .order("year", { ascending: false })
        .order("period", { ascending: false })
        .limit(10);

    if (history && history.length > 0) {
        const latest = history[0];
        return {
            ...mapMeasurementBusinessToRef(latest),
            source_type: 'latest_history',
            source_desc: `${latest.year}년 ${latest.period}`
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
        manager_mobile: data.manager_mobile,
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
        manager_mobile: data.manager_mobile,
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

