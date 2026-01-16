/**
 * 측정 대상 사업장 조회 API
 * GET /api/businesses
 * 
 * 파라미터:
 * - year: 측정년도 (필수)
 * - period: 측정주기 (필수)
 * - designatedOffice: 지정지청 필터 (선택)
 * - address: 주소 검색 (선택)
 * - businessName: 사업장명 검색 (선택)
 * - isRegistered: 실시여부 필터 - "등록됨", "미등록" (선택)
 * 
 * 반환:
 * - businesses: 측정 대상 사업장 목록 (저장된 계획 데이터)
 *   - 각 항목에 isRegistered (측정일지 등록 여부)와 journal_id 포함
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { classifyDesignatedOffice, shortNameToFullName, findOfficeByAddress, getDesignatedOfficeByAddress } from "@/lib/utils/jurisdiction-matcher";
import { toShortName } from "@/lib/constants/designated-offices";
import { normalizeAddress, validateDesignatedOffice, normalizeString } from "@/lib/utils/data-utils";

export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const period = searchParams.get("period");
    const designatedOffice = searchParams.get("designatedOffice")?.trim() || null;
    const address = searchParams.get("address")?.trim() || null;
    const businessName = searchParams.get("businessName")?.trim() || null;
    const isRegistered = searchParams.get("isRegistered")?.trim() || null;

    if (!year || !period) {
      return NextResponse.json(
        { error: "측정년도와 측정주기는 필수입니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const targetYear = parseInt(year, 10);
    
    console.log(`[측정 대상 사업장 조회] year: ${targetYear}, period: ${period}`);

    // 저장된 측정 대상 사업장 계획 조회
    // measurement_target_business 테이블에서 해당 년도/반기의 계획 데이터 조회
    let query = supabase
      .from("measurement_target_business")
      .select("*")
      .eq("year", targetYear)
      .eq("period", period);

    // 주소 필터 적용
    if (address) {
      query = query.ilike("address", `%${address}%`);
    }

    // 사업장명 필터 적용
    if (businessName) {
      query = query.ilike("business_name", `%${businessName}%`);
    }

    // 지정지청 필터 적용
    if (designatedOffice) {
      const normalizedOffice = toShortName(designatedOffice);
      query = query.eq("designated_office", normalizedOffice);
    }

    const { data: plans, error: plansError } = await query.order("code", { ascending: true });

    if (plansError) {
      console.error("측정 대상 사업장 계획 조회 오류:", JSON.stringify(plansError, null, 2));
      // 테이블이 없는 경우 등 초기 상태에서는 빈 배열 반환
      if (plansError.code === "PGRST204" || plansError.message?.includes("does not exist") || plansError.message?.includes("42P01")) {
        return NextResponse.json({
          businesses: [],
          count: 0,
          message: "측정 대상 사업장 계획 테이블이 없습니다. 마이그레이션을 실행해주세요.",
        });
      }
      return NextResponse.json(
        { 
          error: "측정 대상 사업장 계획 조회 중 오류가 발생했습니다.",
          details: plansError.message || String(plansError)
        },
        { status: 500 }
      );
    }

    if (!plans || plans.length === 0) {
      return NextResponse.json({
        businesses: [],
        count: 0,
        message: "해당 년도/반기의 측정 대상 사업장 계획이 없습니다. 먼저 계획을 생성해주세요.",
      });
    }

    // 등록된 측정일지 정보 조회 (진행 상황 반영)
    const codes = plans.map((plan: any) => plan.code).filter(Boolean);
    
    let registeredJournals: any[] | null = null;
    if (codes.length > 0) {
      const { data, error: registeredJournalsError } = await supabase
        .from("measurement_journal")
        .select("id, code, measurement_year, measurement_period, national_support_status, manager_name, manager_mobile, phone, designated_office, address, office_jurisdiction, measurement_start_date, measurement_end_date, completion_status, measurer, business_name, business_number, total_employees")
        .in("code", codes)
        .eq("measurement_year", targetYear)
        .eq("measurement_period", period);

      if (registeredJournalsError) {
        console.error("등록된 측정일지 조회 오류:", registeredJournalsError);
      } else {
        registeredJournals = data;
      }
    }

    const registeredJournalMap = new Map<string, any>();
    if (registeredJournals) {
      registeredJournals.forEach((journal: any) => {
        registeredJournalMap.set(journal.code, journal);
      });
    }

    // business_info에서 향후측정예상일 정보 가져오기
    let businessInfoDateData: any[] | null = null;
    if (codes.length > 0) {
      const { data, error: businessInfoDateError } = await supabase
        .from("business_info")
        .select("code, future_measurement_date")
        .in("code", codes);

      if (businessInfoDateError) {
        console.error("사업장정보 조회 오류:", businessInfoDateError);
      } else {
        businessInfoDateData = data;
      }
    }

    const businessInfoDateMap = new Map<string, string | null>();
    if (businessInfoDateData) {
      businessInfoDateData.forEach((info: any) => {
        businessInfoDateMap.set(info.code, info.future_measurement_date || null);
      });
    }

    // business_info에서 추가 정보 가져오기 (전화번호, 주소, 담당자명 등)
    let businessInfoFullData: any[] | null = null;
    if (codes.length > 0) {
      const { data, error: businessInfoFullError } = await supabase
        .from("business_info")
        .select("code, phone, address1, address2, manager_name")
        .in("code", codes);

      if (businessInfoFullError) {
        console.error("사업장정보 조회 오류:", businessInfoFullError);
      } else {
        businessInfoFullData = data;
      }
    }

    const businessInfoPhoneMap = new Map<string, string | null>();
    const businessInfoAddressMap = new Map<string, string | null>();
    const businessInfoManagerNameMap = new Map<string, string | null>();
    
    if (businessInfoFullData) {
      businessInfoFullData.forEach((info: any) => {
        businessInfoPhoneMap.set(info.code, info.phone || null);
        const addressParts = [info.address1, info.address2]
          .map(addr => (addr && typeof addr === 'string' ? addr.trim() : null))
          .filter(addr => addr && addr.length > 0);
        const fullAddress = addressParts.length > 0 ? addressParts.join(" ").trim() : null;
        businessInfoAddressMap.set(info.code, fullAddress);
        businessInfoManagerNameMap.set(info.code, info.manager_name || null);
      });
    }

    // 건강디딤돌 신청결과 조회
    let nationalSupportMap = new Map<string, string | null>();
    if (codes.length > 0) {
      const { data: nationalSupportData, error: nationalSupportError } = await supabase
        .from("national_support_application")
        .select("code, year, period, national_support_status")
        .in("code", codes)
        .eq("year", targetYear)
        .eq("period", period);

      if (!nationalSupportError && nationalSupportData) {
        nationalSupportData.forEach((item: any) => {
          const key = `${item.code}-${item.year}-${item.period}`;
          nationalSupportMap.set(key, item.national_support_status || null);
        });
      }
    }

    // 지정지청 계산 함수
    const calculateDesignatedOffice = (
      address: string | null,
      officeJurisdiction: string | null,
      journalDesignatedOffice: string | null,
      planDesignatedOffice: string | null,
      code: string
    ): string => {
      let finalOffice: string | null = null;
      
      // 1순위: 주소 기반 계산
      if (address) {
        try {
          const addressBased = getDesignatedOfficeByAddress(address);
          const validated = validateDesignatedOffice(addressBased);
          if (validated) {
            finalOffice = validated;
          }
        } catch (error) {
          console.error(`[지정지청] 코드 ${code}: 주소 기반 계산 오류:`, error);
        }
      }
      
      // 2순위: office_jurisdiction 기반 계산
      if (!finalOffice && officeJurisdiction) {
        try {
          const officeFullName = shortNameToFullName(officeJurisdiction) || officeJurisdiction;
          const officeBased = classifyDesignatedOffice(officeFullName);
          const validated = validateDesignatedOffice(officeBased);
          if (validated) {
            finalOffice = validated;
          }
        } catch (error) {
          console.error(`[지정지청] 코드 ${code}: 관할청 기반 계산 오류:`, error);
        }
      }
      
      // 3순위: 계획의 designated_office
      if (!finalOffice && planDesignatedOffice) {
        const validated = validateDesignatedOffice(planDesignatedOffice);
        if (validated) {
          finalOffice = validated;
        }
      }
      
      // 4순위: measurement_journal의 designated_office
      if (!finalOffice && journalDesignatedOffice) {
        const validated = validateDesignatedOffice(journalDesignatedOffice);
        if (validated) {
          finalOffice = validated;
        }
      }
      
      // 기본값
      return finalOffice || "천안";
    };

    // 결과 생성
    let businesses: BusinessEntryResponse[] = plans.map((plan: any) => {
      const journal = registeredJournalMap.get(plan.code);
      const journalId = plan.journal_id || journal?.id || null;
      const isRegistered = plan.is_registered || journalId !== null;

      // 주소 가져오기 (우선순위: measurement_journal -> business_info -> plan)
      const addressFromJournal = normalizeAddress(journal?.address);
      const addressFromBusinessInfo = normalizeAddress(businessInfoAddressMap.get(plan.code));
      const addressFromPlan = normalizeAddress(plan.address);
      const address = addressFromJournal || addressFromBusinessInfo || addressFromPlan;
      
      // office_jurisdiction 결정
      let officeJurisdiction = normalizeString(journal?.office_jurisdiction) || normalizeString(plan.office_jurisdiction) || null;
      
      if (!officeJurisdiction && addressFromBusinessInfo) {
        try {
          const officeByAddress = findOfficeByAddress(addressFromBusinessInfo);
          if (officeByAddress) {
            officeJurisdiction = shortNameToFullName(officeByAddress);
          }
        } catch (error) {
          console.error(`코드 ${plan.code} business_info 주소 기반 관할청 찾기 오류:`, error);
        }
      }
      
      if (!officeJurisdiction && address) {
        try {
          const officeByAddress = findOfficeByAddress(address);
          if (officeByAddress) {
            officeJurisdiction = shortNameToFullName(officeByAddress);
          }
        } catch (error) {
          console.error(`코드 ${plan.code} 주소 기반 관할청 찾기 오류:`, error);
        }
      }
      
      // 지정지청 계산
      const autoDesignatedOffice = calculateDesignatedOffice(
        address,
        officeJurisdiction,
        journal?.designated_office || null,
        plan.designated_office || null,
        plan.code
      );

      // 향후측정예상일
      const futureMeasurementDate = plan.future_measurement_date || businessInfoDateMap.get(plan.code) || null;

      // 담당자 정보
      const managerName = normalizeString(journal?.manager_name) || normalizeString(businessInfoManagerNameMap.get(plan.code)) || normalizeString(plan.manager_name) || null;
      const managerMobile = normalizeString(journal?.manager_mobile) || normalizeString(plan.manager_mobile) || null;
      const managerPhone = normalizeString(businessInfoPhoneMap.get(plan.code)) || normalizeString(journal?.phone) || normalizeString(plan.manager_phone) || null;

      // 국고지원 여부
      const nationalSupportKey = `${plan.code}-${plan.year}-${plan.period}`;
      const nationalSupportStatus = journal?.national_support_status || plan.national_support_status || nationalSupportMap.get(nationalSupportKey) || null;

      return {
        code: plan.code,
        year: plan.year,
        period: plan.period,
        business_name: journal?.business_name || plan.business_name,
        business_number: journal?.business_number || plan.business_number || null,
        total_employees: journal?.total_employees || plan.total_employees || null,
        address: address,
        office_jurisdiction: officeJurisdiction,
        designated_office: autoDesignatedOffice,
        measurement_start_date: journal?.measurement_start_date || plan.measurement_start_date || null,
        measurement_end_date: journal?.measurement_end_date || plan.measurement_end_date || null,
        completion_status: journal?.completion_status || plan.completion_status || null,
        measurer: journal?.measurer || plan.measurer || null,
        future_measurement_date: futureMeasurementDate,
        isRegistered,
        journal_id: journalId,
        national_support_status: nationalSupportStatus,
        manager_name: managerName,
        manager_mobile: managerMobile,
        manager_phone: managerPhone,
        notes: plan.notes || null,
      };
    });

    // 실시여부 필터 적용
    if (isRegistered === "등록됨") {
      businesses = businesses.filter((b) => b.isRegistered);
    } else if (isRegistered === "미등록") {
      businesses = businesses.filter((b) => !b.isRegistered);
    }

    // 정렬 (코드순)
    businesses.sort((a, b) => a.code.localeCompare(b.code));

    return NextResponse.json({
      businesses: businesses,
      count: businesses.length,
    });
  } catch (error) {
    console.error("측정 대상 사업장 조회 API 오류:", error);
    console.error("오류 상세:", error instanceof Error ? error.stack : String(error));

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
        error: "측정 대상 사업장 조회 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}

interface BusinessEntryResponse {
  code: string;
  year: number;
  period: string;
  business_name: string;
  business_number: string | null;
  total_employees: number | null;
  address: string | null;
  office_jurisdiction: string | null;
  designated_office: string | null;
  measurement_start_date: string | null;
  measurement_end_date: string | null;
  completion_status: string | null;
  measurer: string | null;
  future_measurement_date: string | null;
  isRegistered: boolean;
  journal_id: number | null;
  national_support_status: string | null; // '지원' 또는 null
  manager_name: string | null;
  manager_mobile: string | null;
  manager_phone: string | null;
  notes: string | null;
}
