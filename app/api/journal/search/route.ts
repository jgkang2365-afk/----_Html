import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { classifyDesignatedOffice } from "@/lib/utils/jurisdiction-matcher";

/**
 * 측정일지 검색 API
 * 핵심 요구사항: "직전(가장 최신 자료)의 자료를 불러와야 한다"
 * - measurement_journal이 있으면 그것을 우선 사용
 * - 없으면 measurement_business에서 최신 데이터를 가져와서 반환
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 체크: journal:read 권한 필요
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const measurementYear = searchParams.get("measurementYear")?.trim() || null;
    const measurementPeriod = searchParams.get("measurementPeriod")?.trim() || null;
    const businessName = searchParams.get("businessName")?.trim() || null;
    const designatedOffice = searchParams.get("designatedOffice")?.trim() || null;
    const address = searchParams.get("address")?.trim() || null;

    const supabase = await createClient();

    // 1. measurement_business에서 검색 (직전 최신 자료)
    let businessQuery = supabase
      .from("measurement_business")
      .select("*")
      .not("business_name", "ilike", "%번외%")
      .order("year", { ascending: false })
      .order("period", { ascending: false })
      .order("created_at", { ascending: false });

    // 검색 조건 적용
    if (measurementYear) {
      businessQuery = businessQuery.eq("year", parseInt(measurementYear));
    }

    if (measurementPeriod) {
      businessQuery = businessQuery.eq("period", measurementPeriod);
    }

    if (businessName) {
      businessQuery = businessQuery.ilike("business_name", `%${businessName}%`);
    }

    if (address) {
      businessQuery = businessQuery.ilike("address", `%${address}%`);
    }

    // designatedOffice는 measurement_business에 없으므로 나중에 필터링
    // (office_jurisdiction으로는 정확한 매칭이 어려움)

    const { data: businessData, error: businessError } = await businessQuery;

    if (businessError) {
      console.error("측정사업장 검색 오류:", businessError);
      return NextResponse.json(
        { error: "검색 중 오류가 발생했습니다.", details: businessError.message },
        { status: 500 }
      );
    }

    // 2. measurement_journal에서 검색
    let journalQuery = supabase
      .from("measurement_journal")
      .select("*")
      .not("business_name", "ilike", "%번외%")
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false })
      .order("created_at", { ascending: false });

    if (measurementYear) {
      journalQuery = journalQuery.eq("measurement_year", parseInt(measurementYear));
    }

    if (measurementPeriod) {
      journalQuery = journalQuery.eq("measurement_period", measurementPeriod);
    }

    if (businessName) {
      journalQuery = journalQuery.ilike("business_name", `%${businessName}%`);
    }

    if (designatedOffice) {
      journalQuery = journalQuery.eq("designated_office", designatedOffice);
    }

    if (address) {
      journalQuery = journalQuery.ilike("address", `%${address}%`);
    }

    const { data: journalData, error: journalError } = await journalQuery;

    if (journalError) {
      console.error("측정일지 검색 오류:", journalError);
      return NextResponse.json(
        { error: "검색 중 오류가 발생했습니다.", details: journalError.message },
        { status: 500 }
      );
    }

    // 3. business_info 조회 (모든 code에 대해)
    const allCodes = new Set<string>();
    (journalData || []).forEach((j: any) => allCodes.add(j.code));
    (businessData || []).forEach((b: any) => allCodes.add(b.code));

    const businessInfoMap = new Map<string, any>();
    if (allCodes.size > 0) {
      const { data: businessInfoData, error: businessInfoError } = await supabase
        .from("business_info")
        .select("*")
        .in("code", Array.from(allCodes));

      if (!businessInfoError && businessInfoData) {
        businessInfoData.forEach((info: any) => {
          businessInfoMap.set(info.code, info);
        });
      }
    }

    // 4. measurement_journal이 있으면 우선 사용, 없으면 measurement_business 데이터를 변환
    const journalMap = new Map<string, any>();
    (journalData || []).forEach((journal: any) => {
      const key = `${journal.code}-${journal.measurement_year}-${journal.measurement_period}`;
      journalMap.set(key, journal);
    });

    // measurement_business 데이터를 measurement_journal 형식으로 변환
    const results: any[] = [];
    const processedKeys = new Set<string>();

    // 먼저 measurement_journal 데이터 추가 (business_info 정보 병합)
    (journalData || []).forEach((journal: any) => {
      const key = `${journal.code}-${journal.measurement_year}-${journal.measurement_period}`;
      if (!processedKeys.has(key)) {
        // business_info 정보로 보완
        const businessInfo = businessInfoMap.get(journal.code);
        if (businessInfo) {
          journal.business_number = journal.business_number || businessInfo.business_number;
          journal.representative_name = journal.representative_name || businessInfo.representative_name;
          journal.phone = journal.phone || businessInfo.phone;
          journal.fax = journal.fax || businessInfo.fax;
        }
        // measurement_business에서 담당자 정보 가져오기 (journal에 없으면)
        const matchingBusiness = businessData?.find(
          (b: any) => b.code === journal.code && b.year === journal.measurement_year && b.period === journal.measurement_period
        );
        if (matchingBusiness) {
          journal.manager_name = journal.manager_name || matchingBusiness.manager_name || null;
          journal.manager_position = journal.manager_position || matchingBusiness.manager_position || null;
          journal.manager_mobile = journal.manager_mobile || matchingBusiness.manager_mobile || null;
          journal.manager_email = journal.manager_email || matchingBusiness.manager_email || null;
          journal.invoice_email = journal.invoice_email || matchingBusiness.invoice_email || null;
          journal.industrial_accident_number = journal.industrial_accident_number || matchingBusiness.industrial_accident_number || null;
        }
        results.push(journal);
        processedKeys.add(key);
      }
    });

    // measurement_business 데이터 중 journal에 없는 것만 추가
    (businessData || []).forEach((business: any) => {
      const key = `${business.code}-${business.year}-${business.period}`;
      if (!journalMap.has(key)) {
        // business_info 정보 가져오기
        const businessInfo = businessInfoMap.get(business.code);

        // measurement_business를 measurement_journal 형식으로 변환
        const journalEntry = {
          id: null, // journal이 아니므로 null
          code: business.code,
          measurement_year: business.year,
          measurement_period: business.period,
          business_name: business.business_name,
          designated_office: business.office_jurisdiction || "", // 지정한계_관할지청은 나중에 자동 계산
          address: business.address || "",
          completion_status: business.completion_status || "미완료",
          measurement_start_date: business.measurement_start_date,
          measurement_end_date: business.measurement_end_date,
          measurer: business.measurer || null,
          total_employees: business.total_employees,
          office_jurisdiction: business.office_jurisdiction,
          note: null,
          document_number: null,
          sequence_number: null,
          five_plus_sequence: null,
          created_at: business.created_at,
          updated_at: business.updated_at,
          // business_info에서 가져오기
          business_number: business.business_number || (businessInfo?.business_number || null),
          representative_name: business.representative_name || businessInfo?.representative_name || null,
          phone: businessInfo?.phone || null,
          fax: businessInfo?.fax || null,
          // measurement_business에서 담당자 정보 가져오기
          industrial_accident_number: business.industrial_accident_number || null,
          manager_name: business.manager_name || null,
          manager_position: business.manager_position || null,
          manager_mobile: business.manager_mobile || null,
          manager_email: business.manager_email || null,
          invoice_email: business.invoice_email || null,
          // measurement_journal에만 있는 필드들은 null
          national_support_status: null,
          k2b_send_date: null,
          k2b_sender: null,
          invoice_email: null,
          electronic_invoice_date: null,
          measurement_fee_total: null,
          measurement_fee_business: null,
          measurement_fee_national: null,
          deposit_total: null,
          deposit_date_business: null,
          deposit_amount_business: null,
          deposit_date_national: null,
          deposit_amount_national: null,
          special_notes: null,
          created_by: null,
          updated_by: null,
          _isFromBusiness: true, // measurement_business에서 온 데이터임을 표시
        };

        results.push(journalEntry);
        processedKeys.add(key);
      }
    });

    // designatedOffice 필터링 (지정한계_관할지청) - 결과에서 필터링
    let filteredResults = results;
    if (designatedOffice) {
      filteredResults = results.filter((entry) => {
        // measurement_journal에 있는 경우
        if (entry.designated_office) {
          return entry.designated_office === designatedOffice;
        }
        // measurement_business에서 온 경우 - office_jurisdiction을 기반으로 designated_office 계산
        if (entry.office_jurisdiction) {
          const calculatedDesignatedOffice = classifyDesignatedOffice(entry.office_jurisdiction);
          return calculatedDesignatedOffice === designatedOffice;
        }
        // office_jurisdiction도 없으면 필터링에서 제외
        return false;
      });
    }

    // 최신 자료 우선 정렬 (년도 → 주기 → 생성일)
    filteredResults.sort((a, b) => {
      if (a.measurement_year !== b.measurement_year) {
        return b.measurement_year - a.measurement_year;
      }
      if (a.measurement_period !== b.measurement_period) {
        return b.measurement_period.localeCompare(a.measurement_period);
      }
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });

    return NextResponse.json({ results: filteredResults });
  } catch (error) {
    console.error("측정일지 검색 API 오류:", error);

    if (error instanceof Error) {
      if (error.message.includes("Unauthorized")) {
        return NextResponse.json(
          { error: "로그인이 필요합니다." },
          { status: 401 }
        );
      }
      if (error.message.includes("Forbidden")) {
        return NextResponse.json(
          { error: "권한이 없습니다." },
          { status: 403 }
        );
      }
    }

    return NextResponse.json(
      {
        error: "검색 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
