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
    // 환경 변수 확인
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.error("[API /api/journal/search] Supabase 환경 변수가 설정되지 않았습니다.");
      return NextResponse.json(
        {
          error: "서버 설정 오류",
          details: "Supabase 환경 변수가 설정되지 않았습니다. .env.local 파일을 확인하세요."
        },
        { status: 500 }
      );
    }

    // 권한 체크: journal:read 권한 필요
    try {
      await checkPermission("journal:read");
    } catch (permissionError: any) {
      console.error("[API /api/journal/search] 권한 체크 오류:", permissionError);
      console.error("[API /api/journal/search] 권한 체크 오류 스택:", permissionError?.stack);
      console.error("[API /api/journal/search] 권한 체크 오류 메시지:", permissionError?.message);

      if (permissionError?.message === "Unauthorized") {
        return NextResponse.json(
          { error: "로그인이 필요합니다." },
          { status: 401 }
        );
      }
      if (permissionError?.message === "Forbidden") {
        return NextResponse.json(
          { error: "권한이 없습니다." },
          { status: 403 }
        );
      }
      // 기타 오류는 500으로 반환
      return NextResponse.json(
        {
          error: "권한 확인 중 오류가 발생했습니다.",
          details: permissionError?.message || String(permissionError)
        },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code")?.trim() || null;
    const measurementYear = searchParams.get("measurementYear")?.trim() || null;
    const measurementPeriod = searchParams.get("measurementPeriod")?.trim() || null;
    const businessName = searchParams.get("businessName")?.trim() || null;
    const designatedOffice = searchParams.get("designatedOffice")?.trim() || null;
    const address = searchParams.get("address")?.trim() || null;
    const measurementDate = searchParams.get("measurementDate")?.trim() || null;

    let supabase;
    try {
      supabase = await createClient();
    } catch (supabaseError: any) {
      console.error("[API /api/journal/search] Supabase 클라이언트 생성 오류:", supabaseError);
      return NextResponse.json(
        {
          error: "데이터베이스 연결 오류",
          details: supabaseError?.message || "Supabase 클라이언트를 생성할 수 없습니다."
        },
        { status: 500 }
      );
    }

    // 0. measurementDate가 있으면 preliminary_survey에서 해당 날짜의 사업장 코드/년도/주기 조회
    let dateFilteredCodes: string[] | null = null;
    let dateFilteredKeys: Set<string> | null = null;
    let validSurveys: any[] = [];

    if (measurementDate) {
      const { data: surveys, error: surveyError } = await supabase
        .from("preliminary_survey")
        .select("code, year, period")
        .eq("measurement_date", measurementDate);

      if (surveyError) {
        console.error("예비조사 측정일 검색 오류:", surveyError);
        return NextResponse.json(
          { error: "측정일 검색 중 오류가 발생했습니다.", details: surveyError.message },
          { status: 500 }
        );
      }

      const surveysList = surveys || [];
      if (surveysList.length === 0) {
        return NextResponse.json({ results: [] });
      }

      validSurveys = surveysList;

      // DB 쿼리 최적화를 위한 코드 리스트
      dateFilteredCodes = surveysList.map((s: any) => s.code).filter(Boolean);

      // 정확한 매칭을 위한 (code-year-period) 키 집합
      dateFilteredKeys = new Set(
        surveysList.map((s: any) => `${s.code}-${s.year}-${s.period}`)
      );
      console.log("[DEBUG] Date Filter Keys:", Array.from(dateFilteredKeys));
    }

    // 1. measurement_business에서 검색 (직전 최신 자료)
    let businessQuery = supabase
      .from("measurement_business")
      .select("*")
      .not("business_name", "ilike", "%번외%")
      .order("year", { ascending: false })
      .order("period", { ascending: false })
      .order("created_at", { ascending: false });

    // 측정일 필터 적용 (코드 기준 1차 필터링)
    if (dateFilteredCodes !== null) {
      console.log("[DEBUG] Filtering by codes:", dateFilteredCodes);
      businessQuery = businessQuery.in("code", dateFilteredCodes);
    }

    // 검색 조건 적용
    if (code) {
      if (code.includes(",")) {
        const codes = code.split(",").map(c => c.trim()).filter(Boolean);
        if (codes.length > 0) {
          businessQuery = businessQuery.in("code", codes);
        }
      } else {
        businessQuery = businessQuery.ilike("code", `%${code}%`);
      }
    }

    if (measurementYear) {
      if (measurementYear.includes(",")) {
        const years = measurementYear.split(",").map(y => parseInt(y.trim())).filter(y => !isNaN(y));
        if (years.length > 0) {
          businessQuery = businessQuery.in("year", years);
        }
      } else {
        businessQuery = businessQuery.eq("year", parseInt(measurementYear));
      }
    }

    if (measurementPeriod) {
      if (measurementPeriod.includes(",")) {
        const periods = measurementPeriod.split(",").map(p => p.trim()).filter(Boolean);
        if (periods.length > 0) {
          const orFilter = periods.map(p => `period.ilike.%${p}%`).join(",");
          businessQuery = businessQuery.or(orFilter);
        }
      } else {
        businessQuery = businessQuery.ilike("period", `%${measurementPeriod}%`);
      }
    }

    if (businessName) {
      if (businessName.includes(",")) {
        const names = businessName.split(",").map(n => n.trim()).filter(Boolean);
        if (names.length > 0) {
          const orFilter = names.map(name => `business_name.ilike.%${name}%`).join(",");
          businessQuery = businessQuery.or(orFilter);
        }
      } else {
        businessQuery = businessQuery.ilike("business_name", `%${businessName}%`);
      }
    }

    if (address) {
      if (address.includes(",")) {
        const addresses = address.split(",").map(a => a.trim()).filter(Boolean);
        if (addresses.length > 0) {
          const orFilter = addresses.map(addr => `address.ilike.%${addr}%`).join(",");
          businessQuery = businessQuery.or(orFilter);
        }
      } else {
        businessQuery = businessQuery.ilike("address", `%${address}%`);
      }
    }

    // designatedOffice는 measurement_business에 없으므로 나중에 필터링
    // (office_jurisdiction으로는 정확한 매칭이 어려움)

    const { data: businessDataRaw, error: businessError } = await businessQuery;

    if (businessError) {
      console.error("측정사업장 검색 오류:", businessError);
      return NextResponse.json(
        { error: "검색 중 오류가 발생했습니다.", details: businessError.message },
        { status: 500 }
      );
    }

    // 측정일 필터 적용 (Year/Period 정밀 필터링)
    let businessData = businessDataRaw || [];
    if (dateFilteredKeys !== null) {
      console.log("[DEBUG] Business Data before key filter:", businessData.length);
      if (businessData.length > 0) {
        console.log("[DEBUG] Sample Business Data Key:", `${businessData[0].code}-${businessData[0].year}-${businessData[0].period}`);
      }

      const originalCount = businessData.length;
      businessData = businessData.filter((b: any) =>
        dateFilteredKeys!.has(`${b.code}-${b.year}-${b.period}`)
      );
      console.log(`[DEBUG] Business Data filtered: ${originalCount} -> ${businessData.length}`);
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
    // 중복 제거: 같은 code-year-period 조합 중 가장 최신 것만 조회
    // PostgreSQL의 DISTINCT ON을 사용할 수 없으므로, 모든 데이터를 가져온 후 애플리케이션 레벨에서 중복 제거
    let journalQuery = supabase
      .from("measurement_journal")
      .select("*")
      .not("business_name", "ilike", "%번외%")
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false });

    // 측정일 필터 적용
    if (dateFilteredCodes !== null) {
      journalQuery = journalQuery.in("code", dateFilteredCodes);
    }

    if (code) {
      if (code.includes(",")) {
        const codes = code.split(",").map(c => c.trim()).filter(Boolean);
        if (codes.length > 0) {
          journalQuery = journalQuery.in("code", codes);
        }
      } else {
        journalQuery = journalQuery.ilike("code", `%${code}%`);
      }
    }

    if (measurementYear) {
      if (measurementYear.includes(",")) {
        const years = measurementYear.split(",").map(y => parseInt(y.trim())).filter(y => !isNaN(y));
        if (years.length > 0) {
          journalQuery = journalQuery.in("measurement_year", years);
        }
      } else {
        journalQuery = journalQuery.eq("measurement_year", parseInt(measurementYear));
      }
    }

    if (measurementPeriod) {
      if (measurementPeriod.includes(",")) {
        const periods = measurementPeriod.split(",").map(p => p.trim()).filter(Boolean);
        if (periods.length > 0) {
          const orFilter = periods.map(p => `measurement_period.ilike.%${p}%`).join(",");
          journalQuery = journalQuery.or(orFilter);
        }
      } else {
        journalQuery = journalQuery.ilike("measurement_period", `%${measurementPeriod}%`);
      }
    }

    if (businessName) {
      if (businessName.includes(",")) {
        const names = businessName.split(",").map(n => n.trim()).filter(Boolean);
        if (names.length > 0) {
          const orFilter = names.map(name => `business_name.ilike.%${name}%`).join(",");
          journalQuery = journalQuery.or(orFilter);
        }
      } else {
        journalQuery = journalQuery.ilike("business_name", `%${businessName}%`);
      }
    }

    if (designatedOffice) {
      const officeList = designatedOffice.split(",").map(o => o.trim()).filter(Boolean);
      if (officeList.length > 0) {
        const allOffices: string[] = [];
        officeList.forEach(office => {
          const normalized = toShortName(office);
          allOffices.push(normalized);
          if (normalized !== office) {
            allOffices.push(office);
          }
        });
        journalQuery = journalQuery.in("designated_office", allOffices);
      }
    }

    if (address) {
      if (address.includes(",")) {
        const addresses = address.split(",").map(a => a.trim()).filter(Boolean);
        if (addresses.length > 0) {
          const orFilter = addresses.map(addr => `address.ilike.%${addr}%`).join(",");
          journalQuery = journalQuery.or(orFilter);
        }
      } else {
        journalQuery = journalQuery.ilike("address", `%${address}%`);
      }
    }

    const { data: journalDataRaw, error: journalError } = await journalQuery;

    if (journalError) {
      console.error("측정일지 검색 오류:", journalError);
      return NextResponse.json(
        { error: "검색 중 오류가 발생했습니다.", details: journalError.message },
        { status: 500 }
      );
    }

    // 측정일 필터 적용 (Year/Period 정밀 필터링)
    let journalData = journalDataRaw || [];
    if (dateFilteredKeys !== null) {
      journalData = journalData.filter((j: any) =>
        dateFilteredKeys!.has(`${j.code}-${j.measurement_year}-${j.measurement_period}`)
      );
    }

    // 3. business_info 조회 (모든 code에 대해)
    const allCodes = new Set<string>();
    (journalData || []).forEach((j: any) => allCodes.add(j.code));
    (businessData || []).forEach((b: any) => allCodes.add(b.code));
    // 예비조사 코드도 포함 (데이터가 없는 경우를 대비해)
    if (dateFilteredCodes) {
      dateFilteredCodes.forEach(c => allCodes.add(c));
    }

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

    // 3.5 measurement_target_business 조회 (비고란 데이터 활용을 위해)
    const targetBusinessMap = new Map<string, string>();
    if (allCodes.size > 0) {
      const { data: targetData, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("code, year, period, notes")
        .in("code", Array.from(allCodes));

      if (!targetError && targetData) {
        targetData.forEach((target: any) => {
          // 키: code + year + period
          const key = `${target.code}-${target.year}-${target.period}`;
          if (target.notes) {
            targetBusinessMap.set(key, target.notes);
          }
        });
      }
    }

    // 4. measurement_journal이 있으면 우선 사용, 없으면 measurement_business 데이터를 변환
    // 중복 제거: 같은 code-year-period 조합 중 가장 최신 것만 사용
    const journalMap = new Map<string, any>();
    (journalData || []).forEach((journal: any) => {
      const key = `${journal.code}-${journal.measurement_year}-${journal.measurement_period}`;
      const existing = journalMap.get(key);
      // 기존 항목이 없거나, 현재 항목이 더 최신이면 교체
      if (!existing || new Date(journal.updated_at || journal.created_at) > new Date(existing.updated_at || existing.created_at)) {
        journalMap.set(key, journal);
      }
    });

    // measurement_business 데이터를 measurement_journal 형식으로 변환
    const results: any[] = [];
    const processedKeys = new Set<string>();

    // 먼저 measurement_journal 데이터 추가 (business_info 정보 병합)
    // journalMap에는 이미 중복이 제거된 최신 데이터만 있음
    Array.from(journalMap.values()).forEach((journal: any) => {
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
          journal.commencement_number = journal.commencement_number || matchingBusiness.commencement_number || null;
          // 주소 보완 (measurement_journal에 없으면 measurement_business에서 가져오기)
          if (!journal.address && matchingBusiness.address) {
            journal.address = matchingBusiness.address;
          }
        }

        // measurement_target_business에서 비고(notes) 가져와서 special_notes에 반영
        // 단, 기존 special_notes가 비어있는 경우에만 반영하도록 하여 기존 데이터를 존중함
        if (!journal.special_notes) {
          const targetNotes = targetBusinessMap.get(key);
          if (targetNotes) {
            journal.special_notes = targetNotes;
          }
        }

        // designated_office 재검증 (주소 기반으로 다시 계산)
        // measurement_journal에 저장된 designated_office가 잘못되었을 수 있으므로
        // 주소 기반으로 다시 계산하여 검증
        // designated_office 결정: DB 값 우선, 없으면 주소/관할청 기반 계산
        let finalDesignatedOffice = journal.designated_office ? toShortName(journal.designated_office) : null;

        // DB에 값이 없는 경우에만 자동 계산 시도
        if (!finalDesignatedOffice) {
          // 1순위: 주소 기반
          if (journal.address) {
            const addressBasedOffice = getDesignatedOfficeByAddress(journal.address);
            if (addressBasedOffice) {
              finalDesignatedOffice = addressBasedOffice;
            }
          }

          // 2순위: 관할청 기반
          if (!finalDesignatedOffice && journal.office_jurisdiction) {
            const officeJurisdictionFullName = shortNameToFullName(journal.office_jurisdiction) || journal.office_jurisdiction || "";
            const officeBasedDesignatedOffice = classifyDesignatedOffice(officeJurisdictionFullName);
            if (officeBasedDesignatedOffice) {
              finalDesignatedOffice = officeBasedDesignatedOffice;
            }
          }
        }

        // 최종 설정 (없으면 기본값 '천안')
        journal.designated_office = finalDesignatedOffice || "천안";

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
        const isRegularPeriod = !business.period.includes("수시");

        const journalEntry = {
          id: null, // journal이 아니므로 null
          code: business.code,
          measurement_year: business.year,
          measurement_period: business.period,
          business_name: business.business_name,
          designated_office: autoDesignatedOffice, // 약칭으로 자동 계산
          address: address,
          completion_status: business.completion_status || "미완료",

          // 정기 측정(수시 아님)인 경우, 측정 관련 정보와 담당자 정보를 초기화하여 보여줌
          // (수시 측정 데이터나 잘못된 DB 데이터가 정기 측정에 노출되는 것을 방지)
          measurement_start_date: isRegularPeriod ? null : business.measurement_start_date,
          measurement_end_date: isRegularPeriod ? null : business.measurement_end_date,
          measurer: isRegularPeriod ? null : (business.measurer || null),
          total_employees: isRegularPeriod ? null : business.total_employees,

          office_jurisdiction: officeJurisdictionFullName || business.office_jurisdiction || null,
          note: null,
          document_number: null,
          sequence_number: null,
          five_plus_sequence: null,
          created_at: business.created_at,
          updated_at: business.updated_at,

          // business_info에서 가져오기 (사업자 정보는 공통이므로 유지)
          business_number: business.business_number || (businessInfo?.business_number || null),
          representative_name: business.representative_name || businessInfo?.representative_name || null,
          phone: businessInfo?.phone || null,
          fax: businessInfo?.fax || null,

          // 담당자 정보: 정기 측정인 경우 초기화, 수시인 경우만 가져옴
          industrial_accident_number: isRegularPeriod ? null : (business.industrial_accident_number || null),
          commencement_number: isRegularPeriod ? null : (business.commencement_number || null),
          manager_name: isRegularPeriod ? null : (business.manager_name || businessInfo?.manager_name || null),
          manager_position: isRegularPeriod ? null : (business.manager_position || null),
          manager_mobile: isRegularPeriod ? null : (business.manager_mobile || null),
          manager_email: isRegularPeriod ? null : (business.manager_email || null),
          invoice_email: isRegularPeriod ? null : (business.invoice_email || null),

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
          special_notes: targetBusinessMap.get(key) || null,
          created_by: null,
          updated_by: null,
          _isFromBusiness: true, // measurement_business에서 온 데이터임을 표시
        };

        results.push(journalEntry);
        processedKeys.add(key);
      }
    });

    // 예비조사 데이터 중 아직 결과에 없는 것 추가 (measurement_business에도 없는 경우)
    if (validSurveys.length > 0) {
      validSurveys.forEach((survey: any) => {
        const key = `${survey.code}-${survey.year}-${survey.period}`;
        if (!processedKeys.has(key)) {
          // business_info 정보 가져오기
          const businessInfo = businessInfoMap.get(survey.code);

          if (!businessInfo) return; // 사업장 정보가 없으면 스킵

          // 주소 가져오기
          const address = [businessInfo.address1, businessInfo.address2].filter(Boolean).join(" ").trim();

          // designated_office 계산
          let autoDesignatedOffice = "천안"; // 기본값
          let officeJurisdictionFullName = businessInfo.office_jurisdiction || null;

          // 1순위: 주소 기반
          if (address) {
            const addressBasedOffice = getDesignatedOfficeByAddress(address);
            if (addressBasedOffice) {
              autoDesignatedOffice = addressBasedOffice;
            }
          }

          // 2순위: 관할청 기반
          if (autoDesignatedOffice === "천안" && businessInfo.office_jurisdiction) {
            const officeJurisdictionRaw = businessInfo.office_jurisdiction || "";
            officeJurisdictionFullName = shortNameToFullName(officeJurisdictionRaw) || officeJurisdictionRaw || "";
            const officeBasedDesignatedOffice = classifyDesignatedOffice(officeJurisdictionFullName);
            if (officeBasedDesignatedOffice) {
              autoDesignatedOffice = officeBasedDesignatedOffice;
            }
          }

          const journalEntry = {
            id: null,
            code: survey.code,
            measurement_year: survey.year,
            measurement_period: survey.period,
            business_name: businessInfo.business_name,
            designated_office: autoDesignatedOffice,
            address: address,
            completion_status: "미완료", // 기본값

            measurement_start_date: survey.measurement_date, // 예비조사 측정일을 시작일로 표시
            measurement_end_date: null,
            measurer: survey.measurer || null,
            total_employees: null,

            office_jurisdiction: officeJurisdictionFullName || businessInfo.office_jurisdiction || null,
            note: survey.notes || null, // 예비조사 비고
            document_number: null,
            sequence_number: null,
            five_plus_sequence: null,
            created_at: survey.created_at,
            updated_at: survey.updated_at,

            business_number: businessInfo.business_number || null,
            representative_name: businessInfo.representative_name || null,
            phone: businessInfo.phone || null,
            fax: businessInfo.fax || null,

            industrial_accident_number: null,
            commencement_number: null,
            manager_name: businessInfo.manager_name || null,
            manager_position: null,
            manager_mobile: null,
            manager_email: null,
            invoice_email: null,

            national_support_status: null,
            measurement_fee_total: null,
            measurement_fee_business: null,
            deposit_total: null,
            deposit_amount_business: null,
            special_notes: targetBusinessMap.get(key) || null,
            _isFromSurvey: true, // 예비조사에서 온 데이터임을 표시
          };

          results.push(journalEntry);
          processedKeys.add(key);
        }
      });
    }

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
    // 주기 비교: "하반기" > "상반기"
    const periodOrder: { [key: string]: number } = { "하반기": 2, "상반기": 1 };
    filteredResults.sort((a, b) => {
      if (a.measurement_year !== b.measurement_year) {
        return b.measurement_year - a.measurement_year; // 년도 내림차순
      }
      if (a.measurement_period !== b.measurement_period) {
        // 주기 내림차순 (하반기 > 상반기)
        const periodA = periodOrder[a.measurement_period] || 0;
        const periodB = periodOrder[b.measurement_period] || 0;
        return periodB - periodA;
      }
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA; // 생성일 내림차순
    });

    // 같은 code-year-period 조합에 대해 가장 최신 항목만 유지 (정렬 후 첫 번째 항목이 가장 최신)
    const keyMap = new Map<string, any>();
    filteredResults.forEach((entry: any) => {
      // code + measurement_year + measurement_period 조합을 키로 사용
      const key = `${entry.code}-${entry.measurement_year}-${entry.measurement_period}`;
      const existing = keyMap.get(key);
      // 기존 항목이 없거나, 현재 항목이 더 최신이면 교체
      if (!existing || new Date(entry.updated_at || entry.created_at) > new Date(existing.updated_at || existing.created_at)) {
        keyMap.set(key, entry);
      }
    });

    // Map에서 배열로 변환하고 원래 정렬 순서 유지
    let finalResults = Array.from(keyMap.values());

    // 최종 중복 제거: 혹시 모를 중복을 한 번 더 제거 (id 기준으로도 확인)
    const finalDedupMap = new Map<string, any>();
    finalResults.forEach((entry: any) => {
      const key = `${entry.code}-${entry.measurement_year}-${entry.measurement_period}`;
      const existing = finalDedupMap.get(key);
      if (!existing) {
        finalDedupMap.set(key, entry);
      } else {
        // id가 있는 항목을 우선 (measurement_journal에서 온 데이터)
        if (entry.id && !existing.id) {
          finalDedupMap.set(key, entry);
        } else if (!entry.id && existing.id) {
          // 기존 항목이 measurement_journal에서 온 것이면 유지
          // 아무것도 하지 않음
        } else {
          // 둘 다 id가 있거나 둘 다 없으면 더 최신 것 선택
          const entryDate = new Date(entry.updated_at || entry.created_at || 0);
          const existingDate = new Date(existing.updated_at || existing.created_at || 0);
          if (entryDate > existingDate) {
            finalDedupMap.set(key, entry);
          }
        }
      }
    });
    finalResults = Array.from(finalDedupMap.values());

    // 최종 결과 로그
    console.log(`[검색 API] 최종 반환 결과 수: ${finalResults.length}건 (중복 제거 전: ${filteredResults.length}건)`);
    const finalH0432 = finalResults.filter((r: any) => r.code && r.code.includes("H0432"));
    console.log(`[검색 API] 최종 H0432 데이터: ${finalH0432.length}건`);

    // 중복이 있는지 확인
    const duplicateCheck = new Map<string, number>();
    finalResults.forEach((entry: any) => {
      const key = `${entry.code}-${entry.measurement_year}-${entry.measurement_period}`;
      duplicateCheck.set(key, (duplicateCheck.get(key) || 0) + 1);
    });
    const duplicates = Array.from(duplicateCheck.entries()).filter(([_, count]) => count > 1);
    if (duplicates.length > 0) {
      console.error(`[검색 API] 경고: 중복 항목이 여전히 존재합니다:`, duplicates);
    }

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
      results_after_dedup: finalResults.length,
      h0432_in_business: businessData?.filter((b: any) => b.code && b.code.includes("H0432")).length || 0,
      h0432_in_results: finalH0432.length,
    };

    return NextResponse.json({
      results: finalResults,
      debug: debugInfo, // 프로덕션에서도 디버깅 정보 포함
    });
  } catch (error) {
    console.error("[API /api/journal/search] 측정일지 검색 API 오류:", error);

    if (error instanceof Error) {
      console.error("[API /api/journal/search] 에러 메시지:", error.message);
      console.error("[API /api/journal/search] 에러 스택:", error.stack);

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
        // 개발 환경에서만 스택 트레이스 포함
        ...(process.env.NODE_ENV === "development" && error instanceof Error && error.stack ? { stack: error.stack } : {})
      },
      { status: 500 }
    );
  }
}
