/**
 * 측정 대상 사업장 조회 API
 * GET /api/businesses
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { toShortName } from "@/lib/constants/designated-offices";
import { normalizeAddress, normalizeString } from "@/lib/utils/data-utils";

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

    // 1. 측정 대상 사업장 테이블(measurement_target_business) 조회
    let query = supabase
      .from("measurement_target_business")
      .select("*")
      .eq("year", targetYear)
      .eq("period", period);

    // 검색 필터 적용

    // 주소 (Like 검색)
    if (address) {
      query = query.ilike("address", `%${address}%`);
    }

    // 사업장명 (Like 검색)
    if (businessName) {
      query = query.ilike("business_name", `%${businessName}%`);
    }

    // 실시여부 (Exact 검색)
    if (isRegistered && isRegistered !== "전체") {
      query = query.eq("is_registered", isRegistered);
    }

    // 지정지청 (Exact 검색 or IN 검색) - office_jurisdiction 컬럼 사용? 
    // TRD에는 office_jurisdiction(소재지 관할청)만 있고 designated_office 컬럼이 없음.
    // 하지만 UI 요건상 "지정지청" 필터가 있음.
    // 기존 로직은 주소 기반 계산 등을 수행했음.
    // 새로 만든 테이블에는 'office_jurisdiction'이 있으므로 이를 필터링에 사용할 수 있음.
    // 단, designated_office(지정기관)와 office_jurisdiction(관할청)은 다를 수 있음.
    // 요구사항 분석: "지정지청" 필터는 보통 담당 지역을 의미함. 
    // PRD에는 designated_office 컬럼이 없으므로, office_jurisdiction으로 매핑하거나, 
    // 조회 후 JS 레벨에서 필터링해야 함. 일단 office_jurisdiction을 기준으로 필터링 시도.
    if (designatedOffice && designatedOffice !== "전체") {
      // 입력은 "대전, 천안" 등일 수 있음
      const offices = designatedOffice.split(",").map(o => o.trim()).filter(Boolean);
      // DB에는 약어("천안")로 저장될 것으로 예상됨 (TRD: 소재지 관할청 - 약어로 저장/표시)
      if (offices.length > 0) {
        query = query.in("office_jurisdiction", offices);
      }
    }

    // 정렬: 코드순 (기본)
    query = query.order("code", { ascending: true });

    const { data: businesses, error } = await query;

    if (error) {
      console.error("측정 대상 사업장 조회 오류:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!businesses || businesses.length === 0) {
      return NextResponse.json({
        businesses: [],
        count: 0
      });
    }

    // 2. 미수 내역 집계 (measurement_journal)
    // 조회된 사업장 코드 리스트에 대해 미수금 계산
    const codes = businesses.map((b: any) => b.code);
    const unpaidMap = new Map<string, { count: number; details: any[] }>();

    if (codes.length > 0) {
      // 해당 사업장의 모든 측정일지 중 미수금이 있는 것 조회
      // (amount - deposit > 0)
      const { data: unpaidData } = await supabase
        .from("measurement_journal")
        .select("code, measurement_year, measurement_period, measurement_fee_total, deposit_total, business_name")
        .in("code", codes);

      if (unpaidData) {
        unpaidData.forEach((item: any) => {
          const fee = Number(item.measurement_fee_total || 0);
          const deposit = Number(item.deposit_total || 0);
          const unpaidAmount = fee - deposit;

          if (unpaidAmount > 0) {
            const current = unpaidMap.get(item.code) || { count: 0, details: [] };
            current.count += 1;
            current.details.push({
              year: item.measurement_year,
              period: item.measurement_period,
              amount: unpaidAmount,
              total: fee,
              deposit: deposit
            });
            unpaidMap.set(item.code, current);
          }
        });
      }
    }

    // 3. 추가 데이터 조회 (예비조사 등록 여부 및 향후 측정주기)
    // 예비조사 (Preliminary Survey) 조회 (실시여부 판단용)
    const { data: surveys } = await supabase
      .from("preliminary_survey")
      .select("code")
      .eq("year", targetYear)
      .in("code", codes);

    const surveyRegisteredCodes = new Set(surveys?.map((s: any) => s.code));

    // 향후 측정주기 (measurement_business 테이블에서 최신값 조회)
    // 각 코드별로 가장 최신의 future_measurement_period를 가져옴
    // Note: This requires a customized query or processing in JS. 
    // Given Supabase limitations on complex DISTINCT ON via JS client, we might fetch all valid entries for these codes.
    // Optimization: If dataset is huge, this is slow. But for 50-100 items page, it's fine.
    // Querying measurement_business for these codes.
    const { data: periodData } = await supabase
      .from("measurement_business")
      .select("code, year, period, future_measurement_period")
      .in("code", codes)
      .not("future_measurement_period", "is", null)
      .order("year", { ascending: false })
      .order("period", { ascending: false });

    // Map: Code -> Latest Future Measurement Period
    const latestPeriodMap = new Map<string, number>();
    if (periodData) {
      periodData.forEach((item: any) => {
        if (!latestPeriodMap.has(item.code)) {
          latestPeriodMap.set(item.code, item.future_measurement_period);
        }
      });
    }

    // 4. 데이터 병합
    const result = businesses.map((item: any) => {
      const unpaidInfo = unpaidMap.get(item.code) || { count: 0, details: [] };
      const isSurveyRegistered = surveyRegisteredCodes.has(item.code);

      // 실시여부 로직: 기 입력된 값이 '거래종료'면 유지, 아니면 예비조사 등록 여부에 따라 '실시'/'미실시'
      let isRegisteredText = item.is_registered;
      if (item.is_registered !== "거래종료") {
        isRegisteredText = isSurveyRegistered ? "실시" : "미실시";
      }

      // 향후 측정주기 로직: 최신값 우선, 없으면 현재 값
      const futurePeriod = latestPeriodMap.get(item.code) || item.future_measurement_period;

      return {
        ...item,
        unpaid_count: unpaidInfo.count,
        unpaid_details: unpaidInfo.details,
        // UI 호환성을 위한 필드 매핑
        designated_office: item.office_jurisdiction, // 임시 매핑
        isRegistered: isRegisteredText === "실시", // Frontend 호환성
        is_registered_text: isRegisteredText, // 텍스트 값 전달
        future_measurement_period: futurePeriod, // 최신 값으로 덮어쓰기
      };
    });

    console.log(`[API] 조회된 사업장 수: ${result.length}, 요청 조건: year=${year}, period=${period}`);

    return NextResponse.json({
      businesses: result,
      count: result.length
    });

  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await checkPermission("journal:write");

    const body = await request.json();
    const { id, code, year, period, updates } = body; // id가 있으면 id로, 없으면 복합키로

    if (!updates) {
      return NextResponse.json({ error: "업데이트할 내용이 없습니다." }, { status: 400 });
    }

    const supabase = await createClient();

    let query = supabase.from("measurement_target_business").update({
      ...updates,
      updated_at: new Date().toISOString()
    });

    if (id) {
      query = query.eq("id", id);
    } else if (code && year && period) {
      query = query.eq("code", code).eq("year", year).eq("period", period);
    } else {
      return NextResponse.json({ error: "식별자(id 또는 code/year/period)가 필요합니다." }, { status: 400 });
    }

    const { data, error } = await query.select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });

  } catch (error) {
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

interface BusinessEntryResponse {
  id: number; // Assuming 'id' is now part of the new table
  code: string;
  year: number;
  period: string;
  business_name: string;
  business_number: string | null;
  total_employees: number | null;
  address: string | null;
  office_jurisdiction: string | null;
  designated_office: string | null; // Mapped from office_jurisdiction for UI compatibility
  measurement_start_date: string | null;
  measurement_end_date: string | null;
  completion_status: string | null;
  plan_manager: string | null;
  future_measurement_date: string | null;
  measurement_date: string | null;
  previous_measurement_date: string | null;
  isRegistered: boolean; // Mapped from is_registered for UI compatibility
  is_registered_text: string; // The raw string value from DB
  journal_id: number | null; // This might not be directly from measurement_target_business, but kept for compatibility if needed
  national_support_status: string | null;
  manager_name: string | null;
  manager_mobile: string | null;
  manager_phone: string | null;
  notes: string | null;
  business_category: string | null;
  future_measurement_period: number | null;
  management_status: string | null;
  unpaid_count: number;
  unpaid_details: any[];
  measurer_id: number | null; // [NEW] Added field
  created_at: string; // Assuming these are standard fields in the new table
  updated_at: string;
}
