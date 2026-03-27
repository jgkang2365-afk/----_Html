
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
    industrial_accident_number?: string;
    commencement_number?: string;
    invoice_email?: string;
    representative_name?: string;
    source_type?: 'exact' | 'latest_history' | 'business_info' | 'none';
    source_desc?: string;
}

/**
 * 측정일지 데이터 보정을 위한 "최적의 참조 데이터"를 조회합니다.
 * 우선순위:
 * 1. 측정사업장 (정확히 일치): code + year + period
 * 2. 측정사업장 (최신 이력): code 일치, year(내림차순), period(하반기 우선)
 * 3. 사업장정보: code 일치 (기본 마스터 정보)
 */
export async function getBestReferenceData(
    supabase: SupabaseClient,
    code: string,
    year: number,
    period: string
): Promise<ReferenceData> {
    if (!code) return { source_type: 'none' };

    // 0. 측정 대상 사업장 (정확히 일치): year, period 기준
    const { data: targetMatch } = await supabase
        .from("measurement_target_business")
        .select("*")
        .eq("code", code)
        .eq("year", year)
        .eq("period", period)
        .maybeSingle();

    if (targetMatch) {
        return {
            ...mapTargetBusinessToRef(targetMatch),
            source_type: 'exact',
            source_desc: `측정대상(${year} ${period})`
        };
    }

    // 1. 측정사업장 (정확히 일치)
    const { data: exactMatch } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("code", code)
        .eq("year", year)
        .eq("period", period)
        .maybeSingle();

    if (exactMatch) {
        return {
            ...mapMeasurementBusinessToRef(exactMatch),
            source_type: 'exact',
            source_desc: `${year}년 ${period}`
        };
    }

    // 2. 측정사업장 (최신 이력) - 현재 시점보다 과거 데이터 중 최신
    // 쿼리 복잡성을 줄이기 위해, 해당 코드의 최근 데이터를 가져와서 메모리에서 필터링
    const { data: history } = await supabase
        .from("measurement_business")
        .select("*")
        .eq("code", code)
        .order("year", { ascending: false })
        .order("period", { ascending: false }) // 하반기 > 상반기 (문자열 기준)
        .limit(10);

    if (history && history.length > 0) {
        // 현재 시점(year, period)보다 이전인 데이터 찾기
        // 혹은 입력된 시점과 관계없이 "가장 최신 데이터"를 원하면 그냥 첫 번째를 쓰면 됨.
        // 사용자의 의도는 "빈 값을 채우는 것"이므로, 미래 데이터라도 있다면 채우는게 좋을 수 있음.
        // 하지만 논리적으로 과거 데이터를 가져오는게 맞음.
        // 여기서는 "가장 최신의 유효한 데이터"를 사용 (미래 데이터가 입력되어 있다면 그것도 유효 정보로 간주)

        // 단순하게 가장 최신 데이터를 사용
        const latest = history[0];
        return {
            ...mapMeasurementBusinessToRef(latest),
            source_type: 'latest_history',
            source_desc: `${latest.year}년 ${latest.period}`
        };
    }

    // 3. 사업장정보 (기본 마스터)
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
        manager_mobile: data.manager_mobile,
        phone: data.manager_phone, // measurement_target_business 에서는 manager_phone
        total_employees: data.total_employees,
        business_category: data.business_category,
        industrial_accident_number: data.industrial_accident_number,
        commencement_number: data.commencement_number,
        representative_name: data.representative_name,
    };
}

function mapMeasurementBusinessToRef(data: any): ReferenceData {
    // 총인원이 문자열로 저장되어 있을 경우에 대비해 파싱
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
        industrial_accident_number: data.industrial_accident_number,
        commencement_number: data.commencement_number,
        invoice_email: data.invoice_email,
        representative_name: data.representative_name,
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
        manager_mobile: undefined, // business_info에는 mobile 필드가 명확치 않음 (manager_contact가 있긴 함)
        // manager_contact를 mobile로 매핑 시도
        phone: data.phone,
        fax: data.fax,
        total_employees: data.total_employees, // business_info에도 존재하는 경우 매핑
        commencement_number: data.commencement_number, // 있을 경우
        invoice_email: data.invoice_email,
        representative_name: data.representative_name,
    };
}
