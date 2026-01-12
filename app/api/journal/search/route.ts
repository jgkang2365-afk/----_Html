import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { classifyDesignatedOffice, shortNameToFullName, findOfficeByAddress, getDesignatedOfficeByAddress } from "@/lib/utils/jurisdiction-matcher";
import { toShortName } from "@/lib/constants/designated-offices";

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
    const code = searchParams.get("code")?.trim() || null;
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
    if (code) {
      businessQuery = businessQuery.ilike("code", `%${code}%`);
    }

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

    // 디버깅: 측정사업장 검색 결과 로그
    console.log(`[검색 API] 측정사업장 검색 결과: ${businessData?.length || 0}건`);
    console.log(`[검색 API] 검색 조건 - code: ${code}, year: ${measurementYear}, period: ${measurementPeriod}`);
    if (businessData && businessData.length > 0) {
      console.log(`[검색 API] 측정사업장 샘플 (최대 5건):`, businessData.slice(0, 5).map((b: any) => ({
        code: b.code,
        year: b.year,
        period: b.period,
        business_name: b.business_name
      })));
      // H0432 코드가 있는지 확인
      const h0432Data = businessData.filter((b: any) => b.code && b.code.includes("H0432"));
      console.log(`[검색 API] H0432 포함 데이터: ${h0432Data.length}건`, h0432Data.map((b: any) => ({
        code: b.code,
        year: b.year,
        period: b.period,
        business_name: b.business_name
      })));
    }

    // 2. measurement_journal에서 검색
    let journalQuery = supabase
      .from("measurement_journal")
      .select("*")
      .not("business_name", "ilike", "%번외%")
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false })
      .order("created_at", { ascending: false });

    if (code) {
      journalQuery = journalQuery.ilike("code", `%${code}%`);
    }

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
      // 약칭으로 정규화하여 검색 (기존 전체명과 호환)
      const normalizedOffice = toShortName(designatedOffice);
      // 기존 전체명과 약칭 모두 매칭 (.in() 사용하여 더 안전하게 처리)
      const officesToMatch = [normalizedOffice];
      if (normalizedOffice !== designatedOffice) {
        officesToMatch.push(designatedOffice);
      }
      journalQuery = journalQuery.in("designated_office", officesToMatch);
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
          // 주소 보완 (measurement_journal에 없으면 business_info에서 가져오기)
          if (!journal.address && (businessInfo.address1 || businessInfo.address2)) {
            journal.address = [businessInfo.address1, businessInfo.address2].filter(Boolean).join(" ").trim() || "";
          }
          // 담당자 정보 보완 (measurement_journal에 없으면 business_info에서 가져오기)
          journal.manager_name = journal.manager_name || businessInfo.manager_name || null;
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
          // 주소 보완 (measurement_journal에 없으면 measurement_business에서 가져오기)
          if (!journal.address && matchingBusiness.address) {
            journal.address = matchingBusiness.address;
          }
        }
        // designated_office 재검증 (주소 기반으로 다시 계산)
        // measurement_journal에 저장된 designated_office가 잘못되었을 수 있으므로
        // 주소 기반으로 다시 계산하여 검증
        let finalDesignatedOffice = journal.designated_office ? toShortName(journal.designated_office) : null;
        
        // 1순위: 주소가 있으면 주소 기반으로 designated_office 재계산
        if (journal.address) {
          const addressBasedOffice = getDesignatedOfficeByAddress(journal.address);
          if (addressBasedOffice) {
            finalDesignatedOffice = addressBasedOffice;
          }
        }
        
        // 2순위: office_jurisdiction이 있으면 그것도 검증
        if ((!finalDesignatedOffice || finalDesignatedOffice === "천안") && journal.office_jurisdiction) {
          const officeJurisdictionFullName = shortNameToFullName(journal.office_jurisdiction) || journal.office_jurisdiction || "";
          const officeBasedDesignatedOffice = classifyDesignatedOffice(officeJurisdictionFullName);
          if (officeBasedDesignatedOffice) {
            finalDesignatedOffice = officeBasedDesignatedOffice;
          }
        }
        
        // 최종적으로 결정된 designated_office 설정
        journal.designated_office = finalDesignatedOffice || "천안"; // 기본값
        
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

        // 주소 가져오기 (measurement_business -> business_info 순서)
        const address = business.address || (businessInfo 
          ? [businessInfo.address1, businessInfo.address2].filter(Boolean).join(" ").trim() 
          : "");

        // designated_office 계산: 주소 기반 우선, 그 다음 office_jurisdiction 기반
        let autoDesignatedOffice = "천안"; // 기본값
        let officeJurisdictionFullName = business.office_jurisdiction || null;
        
        // 1순위: 주소 기반으로 designated_office 계산
        if (address) {
          const addressBasedOffice = getDesignatedOfficeByAddress(address);
          if (addressBasedOffice) {
            autoDesignatedOffice = addressBasedOffice;
          }
        }
        
        // 2순위: office_jurisdiction 기반으로 designated_office 계산
        if (autoDesignatedOffice === "천안" && business.office_jurisdiction) {
          const officeJurisdictionRaw = business.office_jurisdiction || "";
          officeJurisdictionFullName = shortNameToFullName(officeJurisdictionRaw) || officeJurisdictionRaw || "";
          const officeBasedDesignatedOffice = classifyDesignatedOffice(officeJurisdictionFullName);
          if (officeBasedDesignatedOffice) {
            autoDesignatedOffice = officeBasedDesignatedOffice;
          }
        }

        // measurement_business를 measurement_journal 형식으로 변환
        const journalEntry = {
          id: null, // journal이 아니므로 null
          code: business.code,
          measurement_year: business.year,
          measurement_period: business.period,
          business_name: business.business_name,
          designated_office: autoDesignatedOffice, // 약칭으로 자동 계산
          address: address,
          completion_status: business.completion_status || "미완료",
          measurement_start_date: business.measurement_start_date,
          measurement_end_date: business.measurement_end_date,
          measurer: business.measurer || null,
          total_employees: business.total_employees,
          office_jurisdiction: officeJurisdictionFullName || business.office_jurisdiction || null,
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
          // 담당자 정보 (measurement_business -> business_info 순서)
          industrial_accident_number: business.industrial_accident_number || null,
          manager_name: business.manager_name || businessInfo?.manager_name || null,
          manager_position: business.manager_position || null,
          manager_mobile: business.manager_mobile || null,
          manager_email: business.manager_email || null,
          invoice_email: business.invoice_email || null,
          // measurement_journal에만 있는 필드들은 null
          national_support_status: null,
          k2b_send_date: null,
          k2b_sender: null,
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

    // 디버깅: 필터링 전 결과 로그
    console.log(`[검색 API] 필터링 전 결과 수: ${results.length}건`);
    const h0432BeforeFilter = results.filter((r: any) => r.code && r.code.includes("H0432"));
    console.log(`[검색 API] 필터링 전 H0432 데이터: ${h0432BeforeFilter.length}건`, h0432BeforeFilter.map((r: any) => ({
      code: r.code,
      year: r.measurement_year,
      period: r.measurement_period,
      business_name: r.business_name,
      designated_office: r.designated_office,
      office_jurisdiction: r.office_jurisdiction
    })));

    // designatedOffice 필터링 (지정한계_관할지청) - 결과에서 필터링
    let filteredResults = results;
    if (designatedOffice && designatedOffice !== "전체") {
      // 약칭으로 정규화 (기존 전체명과 호환)
      const normalizedOffice = toShortName(designatedOffice);
      console.log(`[검색 API] designatedOffice 필터링 적용: ${designatedOffice} -> ${normalizedOffice}`);
      filteredResults = results.filter((entry) => {
        // measurement_journal에 있는 경우 (약칭으로 변환된 상태)
        if (entry.designated_office) {
          const entryOffice = toShortName(entry.designated_office);
          return entryOffice === normalizedOffice || entry.designated_office === designatedOffice;
        }
        // measurement_business에서 온 경우 - office_jurisdiction을 기반으로 designated_office 계산
        if (entry.office_jurisdiction) {
          // office_jurisdiction이 약칭일 수 있으므로 전체명으로 변환 후 classifyDesignatedOffice 호출
          const officeJurisdictionFullName = shortNameToFullName(entry.office_jurisdiction) || entry.office_jurisdiction || "";
          const calculatedDesignatedOffice = classifyDesignatedOffice(officeJurisdictionFullName);
          return calculatedDesignatedOffice === normalizedOffice;
        }
        // office_jurisdiction도 없으면 필터링에서 제외
        return false;
      });
      console.log(`[검색 API] designatedOffice 필터링 후 결과 수: ${filteredResults.length}건`);
      const h0432AfterFilter = filteredResults.filter((r: any) => r.code && r.code.includes("H0432"));
      console.log(`[검색 API] 필터링 후 H0432 데이터: ${h0432AfterFilter.length}건`);
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

    // 최종 결과 로그
    console.log(`[검색 API] 최종 반환 결과 수: ${filteredResults.length}건`);
    const finalH0432 = filteredResults.filter((r: any) => r.code && r.code.includes("H0432"));
    console.log(`[검색 API] 최종 H0432 데이터: ${finalH0432.length}건`);

    // 디버깅 정보 (문제 해결을 위해 프로덕션에서도 포함)
    const debugInfo: any = {
      search_conditions: {
        code,
        measurementYear,
        measurementPeriod,
        businessName,
        designatedOffice,
        address,
      },
      business_data_count: businessData?.length || 0,
      journal_data_count: journalData?.length || 0,
      results_before_filter: results.length,
      results_after_filter: filteredResults.length,
      h0432_in_business: businessData?.filter((b: any) => b.code && b.code.includes("H0432")).length || 0,
      h0432_in_results: finalH0432.length,
    };

    return NextResponse.json({ 
      results: filteredResults,
      debug: debugInfo, // 프로덕션에서도 디버깅 정보 포함
    });
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
