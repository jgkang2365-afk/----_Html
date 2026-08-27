/**
 * 측정 대상 사업장 조회 API
 * GET /api/businesses
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic'; // Force dynamic rendering

import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getSession } from "@/lib/auth/session";
import { toShortName } from "@/lib/constants/designated-offices";
import { normalizeAddress, normalizeString } from "@/lib/utils/data-utils";
import { normalizeAddressForGeocoding } from "@/lib/naver-map/geocoding";
import { createSurveyEvent, updateSurveyEvent, deleteSurveyEvent, getSurveyEvent } from "@/lib/google/calendar";
import { syncBusinessToCalendar } from "@/lib/google/sync-service";
import { findOfficeByAddress } from "@/lib/utils/jurisdiction-matcher";
import {
  ensureBusinessCoordinate,
  invalidateBusinessCoordinateForAddress,
} from "@/lib/business-coordinates/service";
import { normalizeBusinessStatus } from "@/lib/utils/sync-helper";
import { syncToMasterTables } from "@/lib/sync/master-tables";
import {
  hasNationalSupportLookupInformation,
  getInitialNationalSupportState,
  isAdHocMeasurement,
} from "@/lib/national-support/eligibility";
import {
  isValidOptionalManagerEmail,
  normalizeOptionalManagerEmail,
} from "@/lib/business/manager-email";
import { isLegacySurveyUniqueConflict } from "@/lib/business/survey-duplicate";
import { loadV2AutomationPolicy } from "@/lib/preliminary-survey-v2/service";
import { isPreliminarySurveyV2AutomationEnabled } from "@/lib/preliminary-survey-v2/policy";
import {
  getInitialProcessChanged,
  isNullableBusinessType,
  isNullableProcessChanged,
  resolveTargetBusinessCategory,
} from "@/lib/business/target-classification";
import {
  MeasurementDayForm,
  measurementDayFormsFrom,
  serializeMeasurementDayForms,
  validateMeasurementDayForms,
} from "@/lib/business/measurement-day-form";
import {
  isTargetBusinessTerminated,
  normalizeTargetBusinessStatus,
  resolveTargetBusinessStatusForCreate,
  resolveOfficeJurisdiction,
  serializeTargetBusinessFormValues,
} from "@/lib/business/target-business-form";
import {
  buildMeasurementScheduleBlockKeys,
  validateMeasurementDayAvailability,
} from "@/lib/business/measurement-day-availability";

async function validateMeasurementAssignmentsForSave(supabase: any, days: MeasurementDayForm[]) {
  const validation = validateMeasurementDayForms(days);
  if (!validation.valid) return validation;

  const assignmentDates = days.map((day) => day.date).filter(Boolean).sort();
  if (assignmentDates.length === 0) return { valid: true } as const;

  const [{ data: users, error: userError }, { data: blocks, error: blockError }] = await Promise.all([
    supabase.from("users").select("id, name").eq("job", "측정").neq("is_active", false),
    supabase
      .from("user_schedule_blocks")
      .select("user_id, start_date, end_date")
      .lte("start_date", assignmentDates.at(-1)!)
      .gte("end_date", assignmentDates[0]),
  ]);
  if (userError) throw userError;
  if (blockError) throw blockError;

  return validateMeasurementDayAvailability({
    days,
    users: (users || []).map((user: any) => ({ id: Number(user.id), name: String(user.name) })),
    blockedKeys: buildMeasurementScheduleBlockKeys(blocks || []),
  });
}

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
    const businessCategory = searchParams.get("businessCategory")?.trim() || null;
    const confirmedDate = searchParams.get("confirmedDate")?.trim() || null;

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

    // 사업장명 (Like 검색 - 공백 무시)
    if (businessName) {
      // 1. 공백 제거 후 문자 사이사이에 % 삽입하여 유연하게 검색
      // 예: "삼일공업사" -> "%삼%일%공%업%사%"
      // 이렇게 하면 "삼일 공업사", "삼 일 공업 사" 모두 매칭됨
      const searchPattern = businessName.replace(/\s+/g, "").split("").join("%");
      query = query.ilike("business_name", `%${searchPattern}%`);
    }

    // 실시여부 (Exact 검색)
    if (isRegistered && isRegistered !== "전체") {
      query = query.eq("is_registered", isRegistered);
    }

    // 업종분류 (Exact 검색)
    if (businessCategory && businessCategory !== "전체" && businessCategory !== "") {
      query = query.eq("business_category", businessCategory);
    }

    // 확정일 (Exact 검색)
    if (confirmedDate) {
      query = query.eq("measurement_date", confirmedDate);
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
    const unpaidMap = new Map<string, { businessCount: number; nationalCount: number; details: any[] }>();

    if (codes.length > 0) {
      // 해당 사업장의 모든 측정일지 중 미수금이 있는 것 조회
      // (amount - deposit > 0)
      const { data: unpaidData } = await supabase
        .from("measurement_journal")
        .select("code, measurement_year, measurement_period, measurement_fee_total, deposit_total, business_name, electronic_invoice_date, measurement_fee_business, deposit_amount_business, deposit_amount_business_2, measurement_fee_national, deposit_amount_national")
        .in("code", codes);

      if (unpaidData) {
        unpaidData.forEach((item: any) => {
          // 2025년 이후 데이터 정밀 판단 로직 적용
          const mYear = Number(item.measurement_year || 0);
          
          const fee = Number(item.measurement_fee_total || 0);
          const deposit = Number(item.deposit_total || 0);
          const unpaidAmount = fee - deposit;

          // Unpaid Business Amount (Split deposit supported)
          const feeBusiness = Number(item.measurement_fee_business || 0);
          const depositBusiness = Number(item.deposit_amount_business || 0);
          const depositBusiness2 = Number(item.deposit_amount_business_2 || 0);
          
          // 고도화 로직: 측정비(사업장)가 없으면 미수가 아님 (2025년 이후 데이터 기준이나 범용 적용)
          const unpaidBusiness = feeBusiness > 0 ? feeBusiness - (depositBusiness + depositBusiness2) : 0;

          // Unpaid National Amount
          const feeNational = Number(item.measurement_fee_national || 0);
          const depositNational = Number(item.deposit_amount_national || 0);
          
          // 고도화 로직: 측정비(국고)가 없으면 미수가 아님
          const unpaidNational = feeNational > 0 ? feeNational - depositNational : 0;

          if (unpaidBusiness > 0 || unpaidNational > 0) {
            const current = unpaidMap.get(item.code) || { businessCount: 0, nationalCount: 0, details: [] };

            if (unpaidBusiness > 0) current.businessCount += 1;
            if (unpaidNational > 0) current.nationalCount += 1;

            current.details.push({
              year: item.measurement_year,
              period: item.measurement_period,
              amount: unpaidAmount,
              total: fee,
              deposit: deposit,
              invoiceDate: item.electronic_invoice_date,
              unpaidBusiness: unpaidBusiness,
              unpaidNational: unpaidNational
            });
            unpaidMap.set(item.code, current);
          }
        });
      }
    }

    // 3. 추가 데이터 조회 (예비조사 등록 여부 및 향후 측정주기, 최신 사업장 정보)
    // 예비조사 (Preliminary Survey) 조회 (실시여부 판단용)
    const { data: surveys } = await supabase
      .from("preliminary_survey")
      .select("code")
      .eq("year", targetYear)
      .eq("period", period) // Add strict period filtering
      .in("code", codes);

    const surveyRegisteredCodes = new Set(surveys?.map((s: any) => s.code));

    const targetIds = businesses.map((business: any) => Number(business.id));
    const { data: preliminarySurveyV2Plans, error: v2PlanError } = targetIds.length
      ? await supabase.from("preliminary_survey_v2_plans").select("*")
          .in("measurement_target_business_id", targetIds)
      : { data: [], error: null };
    if (v2PlanError) {
      console.error("V2 예비조사 계획 조회 오류:", v2PlanError);
    }
    const preliminarySurveyV2PlanMap = new Map(
      (preliminarySurveyV2Plans || []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]),
    );

    // 향후 측정주기 및 최신 사업장 정보 (measurement_business 테이블에서 최신값 조회)
    // 1순위: measurement_business
    const { data: latestBusinessData } = await supabase
      .from("measurement_business")
      .select("code, year, period, future_measurement_period, business_number, total_employees, phone, business_category")
      .in("code", codes)
      .order("year", { ascending: false })
      .order("period", { ascending: false });

    // 현재 화면의 연도·주기와 정확히 일치하는 MES 담당자 및 근로자 정보
    const { data: exactMeasurementData } = await supabase
      .from("measurement_business")
      .select("code, total_employees, manager_name, manager_mobile, manager_email, updated_at")
      .in("code", codes)
      .eq("year", targetYear)
      .eq("period", period)
      .order("updated_at", { ascending: false });

    // 2순위: measurement_journal
    const { data: latestJournalData } = await supabase
      .from("measurement_journal")
      .select("code, measurement_year, measurement_period, business_number, total_employees, phone, business_category")
      .in("code", codes)
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false });

    // 문서 생성 버튼은 같은 사업장 코드라도 현재 대상의 연도·주기 일지에만 막힌다.
    const actualMeasurementJournalKeys = new Set(
      (latestJournalData || []).map((item: any) =>
        JSON.stringify([item.code, item.measurement_year, item.measurement_period])
      )
    );

    // 3순위 보완: 사업장정보(business_info)에만 있는 기본 사업자등록번호와 대표전화
    const { data: businessInfoData } = await supabase
      .from("business_info")
      .select("code, business_number, phone, fax, invoice_email, latitude, longitude, geocoded_address, geocoded_source_address, geocoding_status, geocoding_error, geocoded_at, geocode_provider, coordinate_locked")
      .in("code", codes);

    // Map: Code -> Latest Info (Business)
    const businessInfoMap = new Map<string, any>();
    if (latestBusinessData) {
      latestBusinessData.forEach((item: any) => {
        if (!businessInfoMap.has(item.code)) {
          businessInfoMap.set(item.code, item);
        }
      });
    }

    const exactMeasurementInfoMap = new Map<string, any>();
    if (exactMeasurementData) {
      exactMeasurementData.forEach((item: any) => {
        if (!exactMeasurementInfoMap.has(item.code)) {
          exactMeasurementInfoMap.set(item.code, item);
        }
      });
    }

    // Map: Code -> Latest Info (Journal)
    const journalInfoMap = new Map<string, any>();
    if (latestJournalData) {
      latestJournalData.forEach((item: any) => {
        if (!journalInfoMap.has(item.code)) {
          journalInfoMap.set(item.code, item);
        }
      });
    }

    const businessBasicInfoMap = new Map<string, any>();
    if (businessInfoData) {
      businessInfoData.forEach((item: any) => {
        if (!businessBasicInfoMap.has(item.code)) {
          businessBasicInfoMap.set(item.code, item);
        }
      });
    }

    // 4. 데이터 병합
    const result = businesses.map((item: any) => {
      // Unpaid Logic Separation (Regular v.s. Ad-hoc)
      const rawUnpaidInfo = unpaidMap.get(item.code) || { businessCount: 0, nationalCount: 0, details: [] };
      const isAdHocItem = item.period && item.period.includes("(수시)");

      // Filter details based on period type
      const filteredDetails = rawUnpaidInfo.details.filter((d: any) => {
        const isAdHocDetail = d.period && d.period.includes("(수시)");
        return isAdHocItem ? isAdHocDetail : !isAdHocDetail;
      });

      // Recalculate counts based on filtered details
      const businessCount = filteredDetails.reduce((sum: number, d: any) => sum + (d.unpaidBusiness > 0 ? 1 : 0), 0);
      const nationalCount = filteredDetails.reduce((sum: number, d: any) => sum + (d.unpaidNational > 0 ? 1 : 0), 0);

      const isSurveyRegistered = surveyRegisteredCodes.has(item.code);

      const bInfo = businessInfoMap.get(item.code);
      const exactInfo = exactMeasurementInfoMap.get(item.code);
      const jInfo = journalInfoMap.get(item.code);
      const basicInfo = businessBasicInfoMap.get(item.code);
      const hasActualMeasurementJournal = actualMeasurementJournalKeys.has(
        JSON.stringify([item.code, item.year, item.period])
      );

      // 실시여부 로직: 기 입력된 값이 '거래종료', '종료', '실시', '미실시' 등 정규화된 값이면 유지.
      // 그 외(null 등)의 경우 기본값('미실시')으로 처리
      let isRegisteredText = normalizeBusinessStatus(item.is_registered);

      // 향후 측정주기 로직: 최신값 우선, 없으면 현재 값
      const futurePeriod = bInfo?.future_measurement_period || item.future_measurement_period;

      // 업종은 측정대상(Target)이 권위 원천이다. 미입력 값일 때만 호환 데이터로 보완한다.
      const businessCategory = resolveTargetBusinessCategory(
        item.business_category,
        bInfo?.business_category,
        jInfo?.business_category,
      );

      let nationalSupportStatus = item.national_support_status;
      if (!nationalSupportStatus) {
        nationalSupportStatus = bInfo?.national_support_status || jInfo?.national_support_status || item.national_support_status;
      }

      // 사업자번호와 대표자명은 기존 보완 규칙을 유지한다.
      const businessNumber = bInfo?.business_number || jInfo?.business_number || basicInfo?.business_number || item.business_number;
      const representativeName = bInfo?.representative_name || jInfo?.representative_name || item.representative_name;

      // 건강디딤돌 담당자는 사용자 저장값을 우선하고, 정확한 연도·주기의 MES 값은 빈칸만 보완한다.
      const managerName = item.manager_name || exactInfo?.manager_name || null;
      const managerMobile = item.manager_mobile || exactInfo?.manager_mobile || null;
      const managerEmail = item.manager_email ?? null;
      const totalEmployees = exactInfo?.total_employees ?? null;

      const industrialAccidentNumber = bInfo?.industrial_accident_number || jInfo?.industrial_accident_number || item.industrial_accident_number;
      const commencementNumber = bInfo?.commencement_number || jInfo?.commencement_number || item.commencement_number;


      return {
        ...item,
        unpaid_count: businessCount, // 사업장 미수 (Calculated)
        national_unpaid_count: nationalCount, // 국고 미수 (Calculated)
        unpaid_details: filteredDetails, // Filtered details
        has_actual_measurement_journal: hasActualMeasurementJournal,
        // UI 호환성을 위한 필드 매핑
        designated_office: item.office_jurisdiction, // 임시 매핑
        isRegistered: isRegisteredText === "실시", // Frontend 호환성
        is_registered_text: isRegisteredText, // 텍스트 값 전달
        future_measurement_period: futurePeriod, // 최신 값으로 덮어쓰기

        // Sync Applied Fields
        business_number: businessNumber,
        total_employees: totalEmployees,
        phone: basicInfo?.phone || null,
        fax: basicInfo?.fax || null,
        invoice_email: basicInfo?.invoice_email || null,
        manager_name: managerName,
        manager_mobile: managerMobile,
        manager_email: managerEmail,
        business_category: /^\d+$/.test(String(businessCategory)) ? `⚠️ 수정필요(${businessCategory})` : businessCategory,
        national_support_status: nationalSupportStatus,
        representative_name: representativeName,
        industrial_accident_number: industrialAccidentNumber,
        commencement_number: commencementNumber,
        // 좌표는 business_info 기본 위치를 우선 사용하고 대상 테이블은 배포 호환 fallback으로만 사용한다.
        latitude: basicInfo?.latitude ?? item.latitude ?? null,
        longitude: basicInfo?.longitude ?? item.longitude ?? null,
        geocoded_address: basicInfo?.geocoded_address ?? item.geocoded_address ?? null,
        geocoded_source_address: basicInfo?.geocoded_source_address ?? item.geocoded_source_address ?? null,
        geocoding_status: basicInfo?.geocoding_status ?? item.geocoding_status ?? "PENDING",
        geocoding_error: basicInfo?.geocoding_error ?? item.geocoding_error ?? null,
        geocoded_at: basicInfo?.geocoded_at ?? item.geocoded_at ?? null,
        geocode_provider: basicInfo?.geocode_provider ?? item.geocode_provider ?? null,
        coordinate_locked: basicInfo?.coordinate_locked ?? item.coordinate_locked ?? false,
        preliminary_survey_v2_plan: preliminarySurveyV2PlanMap.get(Number(item.id)) || null,
      };
    });

    console.log(`[API] 조회된 사업장 수: ${result.length}, 요청 조건: year=${year}, period=${period}`);

    // 예비조사 V2 자동추천 상위 정책 상태 (UI 중지 안내용)
    let preliminarySurveyV2AutomationEnabled = true;
    try {
      const automationPolicy = await loadV2AutomationPolicy(supabase);
      preliminarySurveyV2AutomationEnabled = isPreliminarySurveyV2AutomationEnabled(automationPolicy);
    } catch (policyError) {
      console.warn("[Businesses] 자동추천 정책 조회 실패(기본 ON 처리):", policyError instanceof Error ? policyError.message : "unknown");
    }

    return NextResponse.json({
      businesses: result,
      count: result.length,
      preliminarySurveyV2AutomationEnabled,
    });

  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
export async function PATCH(request: NextRequest) {
  try {
    // console.log(`[PATCH] Request received`); // Optional: keep or remove
    await checkPermission("journal:write");

    const body = await request.json();
    const { id, code, year, period, updates } = body; // id가 있으면 id로, 없으면 복합키로

    if (!updates) {
      return NextResponse.json({ error: "업데이트할 내용이 없습니다." }, { status: 400 });
    }

    const supabase = await createClient();
    console.log("[PATCH] Updates received:", JSON.stringify(updates, null, 2));

    // [New Feature] Fetch existing date for notification check
    let existingDate = null;
    let businessNameForNote = "";
    let existingAddress: string | null = null;
    let coordinateLocked = false;
    let existingMeasurerId: number | null = null;
    let existingLinkMeasurerId: number | null = null;
    let existingCollaborators: string | null = null;
    let existingDailyStaff: any = null;
    let existingTargetId: number | null = null;
    let existingBusinessType: string | null = null;
    let existingProcessChanged: boolean | null = null;
    let existingPeriod: string | null = null;
    let existingYear: number | null = null;

    if (id || (code && year && period)) {
      let bQuery = supabase.from("measurement_target_business").select("id, measurement_date, business_name, address, coordinate_locked, measurer_id, link_measurer_id, collaborators, daily_staff, business_type, process_changed, period, year");
      if (id) {
        bQuery = bQuery.eq("id", id);
      } else if (code && year && period) {
        bQuery = bQuery.eq("code", code).eq("year", year).eq("period", period);
      }
      const { data: oldData } = await bQuery.maybeSingle();
      if (oldData) {
        existingDate = oldData.measurement_date;
        businessNameForNote = oldData.business_name;
        existingAddress = oldData.address;
        coordinateLocked = !!oldData.coordinate_locked;
        existingMeasurerId = oldData.measurer_id;
        existingLinkMeasurerId = oldData.link_measurer_id;
        existingCollaborators = oldData.collaborators;
        existingDailyStaff = oldData.daily_staff;
        existingTargetId = oldData.id;
        existingBusinessType = oldData.business_type ?? null;
        existingProcessChanged = oldData.process_changed ?? null;
        existingPeriod = oldData.period ?? null;
        existingYear = oldData.year ?? null;
      }
    }

    // === [연번 부여 후 권한 가드] ===
    // 측정일지 연번이 부여된(실적으로 확정된) 사업장은 예비조사 계획 핵심값의 실제 변경을 일반 사용자가 할 수 없다.
    // 확정 여부는 별도 컬럼 없이 measurement_journal(연번 부여) 존재로 판별한다.
    const session = await getSession();
    const isAdmin = session?.role === "관리자";
    const normEmpty = (value: any) => (value === "" || value == null ? null : value);
    const planCriticalActuallyChanged =
      (updates.hasOwnProperty('measurer_id') && Number(existingMeasurerId ?? null) !== Number(normEmpty(updates.measurer_id) ?? null)) ||
      (updates.hasOwnProperty('link_measurer_id') && Number(existingLinkMeasurerId ?? null) !== Number(normEmpty(updates.link_measurer_id) ?? null)) ||
      (updates.hasOwnProperty('measurement_date') && (existingDate ?? null) !== normEmpty(updates.measurement_date)) ||
      (updates.hasOwnProperty('business_type') && String(existingBusinessType ?? "") !== String(normEmpty(updates.business_type) ?? "")) ||
      (updates.hasOwnProperty('process_changed') && existingProcessChanged !== normEmpty(updates.process_changed)) ||
      (updates.hasOwnProperty('period') && String(existingPeriod ?? "") !== String(normEmpty(updates.period) ?? "")) ||
      (updates.hasOwnProperty('year') && Number(existingYear) !== Number(updates.year));
    if (!isAdmin && planCriticalActuallyChanged && existingTargetId != null && code && year && period) {
      const basePeriod = String(period).trim().replace("(수시)", "");
      const { data: confirmedJournal } = await supabase
        .from("measurement_journal")
        .select("id")
        .eq("code", code)
        .eq("measurement_year", Number(year))
        .like("measurement_period", `${basePeriod}%`)
        .limit(1)
        .maybeSingle();
      if (confirmedJournal) {
        return NextResponse.json(
          { error: "유효한 측정일지가 있어 찐확정된 사업장입니다. 예비조사 계획 핵심값은 관리자만 수정할 수 있습니다." },
          { status: 403 },
        );
      }
    }

    const allowedUpdateColumns = new Set([
      "business_name", "business_category", "address", "office_jurisdiction",
      "business_number", "invoice_email", "fax",
      "is_registered", "plan_manager", "manager_name",
      "manager_mobile", "manager_phone", "manager_email", "phone", "total_employees", "management_status", "notes", "measurement_date",
      "measurement_end_date", "future_measurement_period", "future_measurement_date",
      "measurer_id", "link_measurer_id", "period", "collaborators", "daily_staff", "representative_name",
      "industrial_accident_number", "commencement_number",
      "latitude", "longitude", "geocoded_address", "geocoding_status",
      "coordinate_locked", "geocoding_method",
      "business_type", "process_changed"
    ]);
    const updatePayload: any = Object.fromEntries(
      Object.entries(updates).filter(([key]) => allowedUpdateColumns.has(key))
    );
    updatePayload.updated_at = new Date().toISOString();

    if (Object.prototype.hasOwnProperty.call(updatePayload, "manager_email")) {
      if (!isValidOptionalManagerEmail(updatePayload.manager_email)) {
        return NextResponse.json(
          { error: "담당자 메일 형식을 확인해 주세요." },
          { status: 400 },
        );
      }
      updatePayload.manager_email = normalizeOptionalManagerEmail(
        updatePayload.manager_email,
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(updatePayload, "business_type") &&
      !isNullableBusinessType(updatePayload.business_type)
    ) {
      return NextResponse.json(
        { error: "business_type 값이 올바르지 않습니다." },
        { status: 400 },
      );
    }
    if (
      Object.prototype.hasOwnProperty.call(updatePayload, "process_changed") &&
      !isNullableProcessChanged(updatePayload.process_changed)
    ) {
      return NextResponse.json(
        { error: "process_changed 값은 boolean 또는 null이어야 합니다." },
        { status: 400 },
      );
    }

    // [The Joo Rule] 수동 업데이트 시에도 숫자형 업종분류 차단
    if (updates.business_category && /^\d+$/.test(String(updates.business_category))) {
      console.warn(`[API] 수동 숫자 업종분류 차단됨: ${updates.business_category}`);
      delete updatePayload.business_category; // 잘못된 데이터는 무시하고 다른 필드만 저장
    }

    // 보고서 담당자·측정 참여자·예비조사자·측정자(공시료)는 서로 다른 역할이다.
    // 사업장 상세 저장에서 link_measurer_id나 기존 V2 조사자와의 일치 여부를 강제하지 않는다.
    // 적용된 계획의 원천값 변화는 workbench에서 재검토 필요로 판정하며 자동 덮어쓰지 않는다.

    const hasMeasurementAssignmentUpdate = ["measurement_date", "measurer_id", "collaborators", "daily_staff"]
      .some((field) => Object.prototype.hasOwnProperty.call(updates, field));
    if (hasMeasurementAssignmentUpdate) {
      const hasDailyStaffUpdate = Object.prototype.hasOwnProperty.call(updates, "daily_staff");
      const finalDays = measurementDayFormsFrom({
        dailyStaff: hasDailyStaffUpdate ? updates.daily_staff : existingDailyStaff,
        measurementDate: Object.prototype.hasOwnProperty.call(updates, "measurement_date") ? updates.measurement_date : existingDate,
        measurerId: Object.prototype.hasOwnProperty.call(updates, "measurer_id") ? updates.measurer_id : existingMeasurerId,
        collaborators: Object.prototype.hasOwnProperty.call(updates, "collaborators") ? updates.collaborators : existingCollaborators,
      });
      const availability = await validateMeasurementAssignmentsForSave(supabase, finalDays);
      if (!availability.valid) {
        return NextResponse.json({ error: availability.message }, { status: 400 });
      }
    }

    // [New Feature] Auto-calculate office_jurisdiction if address is being updated
    if (updates.hasOwnProperty('address')) {
      const office = findOfficeByAddress(updates.address);
      const resolvedOffice = resolveOfficeJurisdiction(updatePayload.office_jurisdiction, office);
      if (resolvedOffice) updatePayload.office_jurisdiction = resolvedOffice;

      // 주소 변경 시 좌표 무효화 (동일 주소가 아니고 수동 고정 상태가 아닌 경우에만 STALE 처리)
      const normalizedOld = normalizeAddressForGeocoding(existingAddress);
      const normalizedNew = normalizeAddressForGeocoding(updates.address);
      
      if (normalizedOld !== normalizedNew && !coordinateLocked) {
        updatePayload.latitude = null;
        updatePayload.longitude = null;
        updatePayload.geocoding_status = "STALE";
        updatePayload.geocoded_address = null;
        updatePayload.geocoded_at = null;
        updatePayload.geocoding_error = null;
        updatePayload.geocode_provider = null;
      }
    }

    let query = supabase.from("measurement_target_business").update(updatePayload);

    if (id) {
      query = query.eq("id", id);
    } else if (code && year && period) {
      query = query.eq("code", code).eq("year", year).eq("period", period);
    } else {
      return NextResponse.json({ error: "식별자(id 또는 code/year/period)가 필요합니다." }, { status: 400 });
    }

    const { data: updatedData, error } = await query.select().single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    let geocodeResult = null;
    if (updates.hasOwnProperty('address') && code) {
      try {
        const invalidation = await invalidateBusinessCoordinateForAddress(supabase, {
          code,
          businessName: updatedData.business_name,
          fallbackAddress: updatedData.address,
        });
        if (invalidation.addressChanged) {
          geocodeResult = await ensureBusinessCoordinate(supabase, {
            code,
            businessName: updatedData.business_name,
            fallbackAddress: updatedData.address,
          });
        }
      } catch (coordinateError) {
        console.error("[BusinessCoordinates] 주소 변경 후 좌표 갱신 실패:", coordinateError instanceof Error ? coordinateError.message : "unknown");
      }
    }

    const supportInfoChanged = [
      "period",
      "representative_name",
      "industrial_accident_number",
      "commencement_number",
    ].some(key => Object.prototype.hasOwnProperty.call(updates, key));

    if (supportInfoChanged) {
      const supportStateUpdates: Record<string, any> = {};
      if (isAdHocMeasurement(updatedData.period)) {
        supportStateUpdates.national_support_status = "비대상";
        supportStateUpdates.sync_status = "성공";
        supportStateUpdates.sync_error_message = null;
      } else if (!updatedData.national_support_status) {
        supportStateUpdates.sync_status = hasNationalSupportLookupInformation(updatedData)
          ? "조회대기"
          : "정보부족";
        supportStateUpdates.sync_error_message = null;
      }

      if (Object.keys(supportStateUpdates).length > 0) {
        const { error: supportStateError } = await supabase
          .from("measurement_target_business")
          .update({ ...supportStateUpdates, updated_at: new Date().toISOString() })
          .eq("id", updatedData.id);
        if (supportStateError) throw supportStateError;
        Object.assign(updatedData, supportStateUpdates);
      }
    }

    // === [Integrated Sync Logic] ===
    // This section handles synchronizing 'preliminary_survey' and Summary fields 
    // whenever any measurement-related field is updated.
    const isMeasurementUpdate = 
      updates.hasOwnProperty('measurement_date') || 
      updates.hasOwnProperty('measurer_id') || 
      updates.hasOwnProperty('collaborators') || 
      updates.hasOwnProperty('daily_staff') ||
      updates.hasOwnProperty('business_name');

    if (isMeasurementUpdate && code && year && period) {
      try {
        console.log(`[Integrated Sync] Starting sync for ${code}...`);
        
        // 1. Determine Source of Truth (daily_staff or single-date fallback)
        // daily_staff가 null이어도 단일 실시일이 함께 오면 단일 일정으로 처리한다.
        // 실시일 없이 null/빈 배열이 온 경우에만 모든 일정을 삭제한다.
        const hasDailyStaffUpdate = Object.prototype.hasOwnProperty.call(updates, "daily_staff");
        const hasSingleMeasurementDate =
          Object.prototype.hasOwnProperty.call(updates, "measurement_date") &&
          Boolean(updates.measurement_date);
        const shouldUseSingleDateFallback =
          hasDailyStaffUpdate && updates.daily_staff == null && hasSingleMeasurementDate;
        let dailyStaff = !hasDailyStaffUpdate || shouldUseSingleDateFallback
          ? undefined
          : (Array.isArray(updates.daily_staff) ? updates.daily_staff : []);
        
        if (dailyStaff === undefined) {
          // Fallback to single-date logic if daily_staff isn't provided in the update
          // but we might need the current state from the DB if only some parts changed
          const mDate = updates.hasOwnProperty('measurement_date') ? updates.measurement_date : updatedData.measurement_date;
          const mId = updates.hasOwnProperty('measurer_id') ? updates.measurer_id : updatedData.measurer_id;
          const collabs = updates.hasOwnProperty('collaborators') ? updates.collaborators : updatedData.collaborators;
          
          if (mDate) {
            dailyStaff = [{
              date: mDate,
              measurer_id: mId,
              collaborators: typeof collabs === 'string' ? collabs.split(",").map(s => s.trim()).filter(Boolean) : (collabs || [])
            }];
          }
        }

        if (Array.isArray(dailyStaff)) {
          // 2. Fetch existing surveys to manage diffs (Add/Update/Delete)
          const { data: existingSurveys, error: existingSurveysError } = await supabase
            .from("preliminary_survey")
            .select("id, measurement_date, google_event_id")
            .eq("code", code).eq("year", year).eq("period", period);

          if (existingSurveysError) {
            throw existingSurveysError;
          }

          const existingDates = new Set(existingSurveys?.map(s => s.measurement_date) || []);
          const incomingDates = new Set(dailyStaff.map((d: any) => d.date).filter(Boolean));

          // 3. Delete surveys for removed dates
          const datesToDelete = Array.from(existingDates).filter(d => !incomingDates.has(d));
          const surveysToDelete = (existingSurveys || []).filter(
            survey => datesToDelete.includes(survey.measurement_date)
          );

          if (datesToDelete.length > 0) {
            const { error: deleteSurveyError } = await supabase
              .from("preliminary_survey")
              .delete()
              .eq("code", code)
              .eq("year", year)
              .eq("period", period)
              .in("measurement_date", datesToDelete);

            if (deleteSurveyError) {
              throw deleteSurveyError;
            }

            // 삭제 전에 확보한 이벤트 ID로 Calendar 이벤트를 직접 제거한다.
            for (const survey of surveysToDelete) {
              if (!survey.google_event_id) continue;
              try {
                await deleteSurveyEvent(survey.google_event_id);
              } catch (calendarDeleteError) {
                console.error(
                  "[Integrated Sync] Failed to delete calendar event " + survey.google_event_id + ":",
                  calendarDeleteError
                );
              }
            }
          }

          // 4. Update or Create surveys for all dates in dailyStaff
          // 중복 방어: (code, year, period, measurement_date) UNIQUE + idempotent UPSERT.
          // Integrated Sync가 관리하는 필드만 갱신하며, preliminary_surveyor / survey_code /
          // google_event_id / assignee_manual_override / notes / created_at / created_by는 보존한다.
          const allCollaboratorsSet = new Set<string>();
          let maxEndDate = null;
          const sortedDates = dailyStaff.map((d: any) => d.date).filter(Boolean).sort();
          if (sortedDates.length > 0) maxEndDate = sortedDates[sortedDates.length - 1];

          for (const entry of dailyStaff) {
            if (!entry.date) continue;

            const mId = entry.measurer_id;
            const { data: userData } = mId ? await supabase.from("users").select("name").eq("id", mId).single() : { data: null };
            const reportWriterName = userData?.name || null;
            const entryCollabs = entry.collaborators || [];

            // Build actual_measurer string for this specific date
            // 측정자 목록(collaborators)을 그대로 사용 - 보고서 담당자는 자동 합산하지 않음
            const actualMeasurer = entryCollabs.length > 0 ? entryCollabs.join(", ") : "";
            entryCollabs.forEach((c: string) => allCollaboratorsSet.add(c.trim()));

            const surveyPayload = {
              code,
              year,
              period,
              measurement_date: entry.date,
              end_date: entry.date,
              report_writer: reportWriterName,
              actual_measurer: actualMeasurer,
              business_name: updates.business_name || updatedData.business_name
            };

            const existing = existingSurveys?.find(s => s.measurement_date === entry.date);
            if (existing) {
              // 기존 행: Integrated Sync 관리 필드만 UPDATE (수동 예비조사 정보 보존)
              const { error: updateError } = await supabase
                .from("preliminary_survey")
                .update({
                  end_date: entry.date,
                  report_writer: reportWriterName,
                  actual_measurer: actualMeasurer,
                  business_name: updates.business_name || updatedData.business_name,
                })
                .eq("id", existing.id);
              if (updateError) throw updateError;
            } else {
              // 신규 행: UPSERT (동시 요청 race 시 UNIQUE가 중복을 방어)
              const { data: maxSeq } = await supabase.from("preliminary_survey").select("sequence_number").order("sequence_number", { ascending: false }).limit(1).maybeSingle();
              const nextSeq = (maxSeq?.sequence_number || 0) + 1;
              const { data: inserted, error: insertError } = await supabase
                .from("preliminary_survey")
                .upsert({ ...surveyPayload, sequence_number: nextSeq }, {
                  onConflict: "code,year,period,measurement_date",
                  ignoreDuplicates: false,
                })
                .select("id, sequence_number")
                .maybeSingle();
              // 동시 요청으로 이미 동일 키 행이 생성된 경우: 이번 legacy UNIQUE 충돌일 때만
              // 해당 행을 조회해 관리 필드만 갱신한다. 다른 23505(다른 constraint)는 일반 오류로 처리한다.
              if (insertError && isLegacySurveyUniqueConflict(insertError)) {
                const { data: racedRow } = await supabase
                  .from("preliminary_survey")
                  .select("id")
                  .eq("code", code)
                  .eq("year", year)
                  .eq("period", period)
                  .eq("measurement_date", entry.date)
                  .maybeSingle();
                if (racedRow) {
                  const { error: racedUpdateError } = await supabase
                    .from("preliminary_survey")
                    .update({
                      end_date: entry.date,
                      report_writer: reportWriterName,
                      actual_measurer: actualMeasurer,
                      business_name: updates.business_name || updatedData.business_name,
                    })
                    .eq("id", racedRow.id);
                  if (racedUpdateError) throw racedUpdateError;
                } else {
                  throw insertError;
                }
              } else if (insertError) {
                throw insertError;
              }
              // 정상 upsert 결과는 별도 사용하지 않는다 (다음 단계에서 summary 계산만 수행)
              void inserted;
            }
          }

          // 5. Update summary fields on measurement_target_business
          const unifiedCollaborators = Array.from(allCollaboratorsSet).filter(Boolean).sort().join(", ");
          const minDate = sortedDates.length > 0 ? sortedDates[0] : null;
          
          const businessUpdatePayload: any = {
            collaborators: unifiedCollaborators || null,
            measurement_date: minDate,
            measurement_end_date: maxEndDate
          };

          // 실시일이 있으면 화면에서 전달된 이전 상태와 관계없이 실시로 확정한다.
          // 거래종료는 사용자가 명시한 최우선 상태이므로 그대로 유지한다.
          const isTerminated = ["거래종료", "종료", "거래 종료"].includes(updatedData.is_registered);
          if (maxEndDate && !isTerminated) {
            businessUpdatePayload.is_registered = "실시";
          }

          // [The Joo Rule] Successful Null: 실시일이 완전히 비워졌고 현재 상태가 '실시' 또는 '확정'이라면 '미실시'로 자동 하향 동기화
          if (!maxEndDate && (updatedData.is_registered === "실시" || updatedData.is_registered === "확정")) {
            businessUpdatePayload.is_registered = "미실시";
          }

          await supabase.from("measurement_target_business").update(businessUpdatePayload)
            .eq("code", code).eq("year", year).eq("period", period);
          
          console.log(`[Integrated Sync] Preliminary surveys and summary updated for ${code}`);
        }

        // 6. 일정이 모두 삭제된 경우에도 고아 이벤트 정리를 위해 항상 동기화한다.
        await syncBusinessToCalendar(supabase, code, year, period);
        console.log("[Integrated Sync] Calendar sync triggered for " + code);
      } catch (syncError) {
        console.error(`[Integrated Sync] Failed for ${code}:`, syncError);
      }
    }


    // [New Feature] Sync 'Business Category' to 'Journal' and 'Master'
    if (updates.hasOwnProperty('business_category') && code) {
      try {
        // 1. 현재 주기의 측정일지 업데이트
        if (year && period) {
          const { error: journalSyncError } = await supabase
            .from("measurement_journal")
            .update({ business_category: updates.business_category })
            .eq("code", code)
            .eq("measurement_year", year)
            .eq("measurement_period", period);
          
          if (journalSyncError) {
            console.error("Journal Category Sync Error:", journalSyncError);
          } else {
            console.log(`[Sync] Updated journal business_category for ${code}`);
          }
        }

        // 2. 마스터 사업장 정보(measurement_business) 업데이트 (차기 주기 반영용)
        const { error: masterSyncError } = await supabase
          .from("measurement_business")
          .update({ business_category: updates.business_category })
          .eq("code", code);

        if (masterSyncError) {
          console.error("Master Business Category Sync Error:", masterSyncError);
        } else {
          console.log(`[Sync] Updated master business_category for ${code}`);
        }
      } catch (e) {
        console.error("Category Sync Exception:", e);
      }
    }

    if (
      code &&
      (
        updates.hasOwnProperty('total_employees') ||
        updates.hasOwnProperty('phone')
      )
    ) {
      try {
        const masterPayload: any = {
          code,
          year: Number(year || updatedData.year),
          period: period || updatedData.period,
          business_name: updatedData.business_name,
          updated_at: new Date().toISOString(),
        };

        if (updates.hasOwnProperty('total_employees')) {
          masterPayload.total_employees = updates.total_employees;
        }
        if (updates.hasOwnProperty('phone')) {
          masterPayload.phone = updates.phone;
        }

        const { error: measurementBusinessSyncError } = await supabase
          .from("measurement_business")
          .upsert(masterPayload, { onConflict: "code,year,period" });

        if (measurementBusinessSyncError) {
          console.error("Measurement Business detail sync error:", measurementBusinessSyncError);
        }

      } catch (detailSyncError) {
        console.error("Business detail sync exception:", detailSyncError);
      }
    }

    // === [마스터 테이블 최종 동기화 Logic] ===
    // 계획 진행 상태가 '실시' 또는 '확정'일 때만, 입력된 건강디딤돌 필수 정보를 마스터 DB에 최종 검증(확정) 저장합니다.
    const isConfirmedStatus = updatedData.is_registered === "실시" || updatedData.is_registered === "확정";
    const hasMasterInfoToSync = 
      updates.hasOwnProperty('representative_name') || 
      updates.hasOwnProperty('industrial_accident_number') || 
      updates.hasOwnProperty('commencement_number') ||
      updates.hasOwnProperty('is_registered');

    if (isConfirmedStatus && hasMasterInfoToSync && code) {
      try {
        await syncToMasterTables(
          supabase,
          code,
          Number(year || updatedData.year),
          period || updatedData.period,
          updatedData.business_name,
          updatedData.representative_name,
          updatedData.industrial_accident_number,
          updatedData.commencement_number
        );
      } catch (syncErr) {
        console.error("[Master Sync Error in PATCH]:", syncErr);
      }
    }

    // === [Decoupled] V2 예비조사 자동 생성/재추천 ===
    // 측정대상사업장 저장은 측정계획 원본(source of truth) 저장만 담당한다.
    // 예비조사 V2 계획의 자동 생성/재추천은 예비조사 영역에서 별도 수행한다.
    // (Phase A: 측정일/실측정자/link/사업장 유형 변경이 있어도 V2 plan을 자동 생성하거나 재추천하지 않는다.)

    return NextResponse.json({
      success: true,
      data: updatedData,
      geocodeStatus: geocodeResult?.geocoding_status || null,
    });

  } catch (error: any) {
    console.error("PATCH API Critical Error:", error);
    return NextResponse.json({
      error: "Internal Server Error",
      details: error?.message || String(error)
    }, { status: 500 });
  }
}
async function syncCreatedTargetMeasurementSchedule(
  supabase: any,
  params: {
    code: string;
    year: number;
    period: string;
    businessName: string;
    targetId: number;
    targetStatus: string | null;
    days: MeasurementDayForm[];
  }
) {
  const days = params.days.filter((day) => Boolean(day.date));
  if (days.length === 0) return;

  const sortedDates = days.map((day) => day.date).sort();
  const incomingDates = new Set(sortedDates);
  const { data: existingSurveys, error: existingSurveysError } = await supabase
    .from("preliminary_survey")
    .select("id, measurement_date, google_event_id")
    .eq("code", params.code)
    .eq("year", params.year)
    .eq("period", params.period);
  if (existingSurveysError) throw existingSurveysError;

  const surveysToDelete = (existingSurveys || []).filter(
    (survey: any) => !incomingDates.has(survey.measurement_date)
  );
  if (surveysToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from("preliminary_survey")
      .delete()
      .eq("code", params.code)
      .eq("year", params.year)
      .eq("period", params.period)
      .in(
        "measurement_date",
        surveysToDelete.map((survey: any) => survey.measurement_date)
      );
    if (deleteError) throw deleteError;
    for (const survey of surveysToDelete) {
      if (!survey.google_event_id) continue;
      try {
        await deleteSurveyEvent(survey.google_event_id);
      } catch (calendarDeleteError) {
        console.error(
          `[Integrated Sync] Failed to delete calendar event ${survey.google_event_id}:`,
          calendarDeleteError
        );
      }
    }
  }

  const reportWriterIds = Array.from(
    new Set(days.map((day) => day.measurerId).filter((id): id is number => id != null))
  );
  const reportWriterNames = new Map<number, string>();
  if (reportWriterIds.length > 0) {
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id, name")
      .in("id", reportWriterIds);
    if (usersError) throw usersError;
    for (const user of users || []) {
      reportWriterNames.set(Number(user.id), String(user.name));
    }
  }

  for (const day of days) {
    const reportWriter =
      day.measurerId == null ? null : reportWriterNames.get(day.measurerId) || null;
    const actualMeasurer = day.collaborators.join(", ");
    const existing = (existingSurveys || []).find(
      (survey: any) => survey.measurement_date === day.date
    );

    if (existing) {
      const { error: updateError } = await supabase
        .from("preliminary_survey")
        .update({
          end_date: day.date,
          report_writer: reportWriter,
          actual_measurer: actualMeasurer,
          business_name: params.businessName,
        })
        .eq("id", existing.id);
      if (updateError) throw updateError;
      continue;
    }

    const { data: maxSequence } = await supabase
      .from("preliminary_survey")
      .select("sequence_number")
      .order("sequence_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const surveyPayload = {
      code: params.code,
      year: params.year,
      period: params.period,
      measurement_date: day.date,
      end_date: day.date,
      report_writer: reportWriter,
      actual_measurer: actualMeasurer,
      business_name: params.businessName,
      sequence_number: (maxSequence?.sequence_number || 0) + 1,
    };
    const { error: insertError } = await supabase.from("preliminary_survey").upsert(surveyPayload, {
      onConflict: "code,year,period,measurement_date",
      ignoreDuplicates: false,
    });
    if (insertError && !isLegacySurveyUniqueConflict(insertError)) throw insertError;
    if (insertError) {
      const { data: racedRow } = await supabase
        .from("preliminary_survey")
        .select("id")
        .eq("code", params.code)
        .eq("year", params.year)
        .eq("period", params.period)
        .eq("measurement_date", day.date)
        .maybeSingle();
      if (!racedRow) throw insertError;
      const { error: racedUpdateError } = await supabase
        .from("preliminary_survey")
        .update({
          end_date: day.date,
          report_writer: reportWriter,
          actual_measurer: actualMeasurer,
          business_name: params.businessName,
        })
        .eq("id", racedRow.id);
      if (racedUpdateError) throw racedUpdateError;
    }
  }

  const collaborators = Array.from(new Set(days.flatMap((day) => day.collaborators)))
    .filter(Boolean)
    .sort()
    .join(", ");
  const summaryUpdates: Record<string, unknown> = {
    measurement_date: sortedDates[0],
    measurement_end_date: sortedDates.at(-1),
    collaborators: collaborators || null,
  };
  if (!isTargetBusinessTerminated(params.targetStatus)) {
    summaryUpdates.is_registered = "실시";
  }
  const { error: summaryError } = await supabase
    .from("measurement_target_business")
    .update(summaryUpdates)
    .eq("id", params.targetId);
  if (summaryError) throw summaryError;

  await syncBusinessToCalendar(supabase, params.code, params.year, params.period);
}

export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");

    const body = await request.json();
    const formValues = serializeTargetBusinessFormValues(body);
    const { code, year } = body;
    const {
      period,
      business_name,
      address,
      plan_manager,
      industrial_accident_number,
      commencement_number,
      representative_name,
      business_number,
      business_category,
      phone,
      fax,
      invoice_email,
      manager_name,
      manager_mobile,
      manager_phone,
      manager_email,
      total_employees,
      office_jurisdiction,
      business_type,
      process_changed,
      is_registered,
      management_status,
      notes,
      measurement_date,
      measurer_id,
      link_measurer_id,
      collaborators,
      daily_staff,
      future_measurement_period,
      future_measurement_date,
    } = formValues;

    // Validation
    if (!code || !year || !period || !business_name) {
      return NextResponse.json(
        { error: "필수 정보가 누락되었습니다. (코드, 년도, 주기, 사업장명)" },
        { status: 400 }
      );
    }
    if (!isValidOptionalManagerEmail(manager_email)) {
      return NextResponse.json({ error: "담당자 메일 형식을 확인해 주세요." }, { status: 400 });
    }

    const normalizedManagerEmail = normalizeOptionalManagerEmail(manager_email);
    const supabase = await createClient();
    const measurementDays = measurementDayFormsFrom({
      dailyStaff: daily_staff,
      measurementDate: measurement_date,
      measurerId: measurer_id,
      collaborators,
    });
    const assignmentValidation = await validateMeasurementAssignmentsForSave(
      supabase,
      measurementDays
    );
    if (!assignmentValidation.valid) {
      return NextResponse.json({ error: assignmentValidation.message }, { status: 400 });
    }
    const measurementSchedule = serializeMeasurementDayForms(measurementDays);

    // 1. 코드 + 연도 + 주기 중복 등록 방지
    const { data: existing } = await supabase
      .from("measurement_target_business")
      .select("id")
      .eq("code", code)
      .eq("year", year)
      .eq("period", period)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "이미 등록된 사업장입니다 (코드/년도/주기 중복)." },
        { status: 409 }
      );
    }

    // Auto-calculate office_jurisdiction based on address
    const calculatedOfficeJurisdiction = address ? findOfficeByAddress(address) : null;
    const industrialAccidentNumber =
      String(industrial_accident_number || "")
        .replace(/\D/g, "")
        .slice(0, 11) || null;
    const commencementNumber =
      String(commencement_number || "")
        .replace(/\D/g, "")
        .slice(0, 11) || null;
    const totalEmployeesValue: unknown = total_employees;
    const parsedTotalEmployees =
      totalEmployeesValue === "" ||
      totalEmployeesValue === null ||
      totalEmployeesValue === undefined
        ? null
        : Number(totalEmployeesValue);
    const normalizedTotalEmployees =
      parsedTotalEmployees !== null && Number.isFinite(parsedTotalEmployees)
        ? parsedTotalEmployees
        : null;
    const initialSupportState = getInitialNationalSupportState({
      period,
      industrial_accident_number: industrialAccidentNumber,
      commencement_number: commencementNumber,
      representative_name,
      manager_name,
      manager_mobile,
    });
    if (!isNullableBusinessType(business_type ?? null)) {
      return NextResponse.json({ error: "business_type 값이 올바르지 않습니다." }, { status: 400 });
    }
    if (
      Object.prototype.hasOwnProperty.call(body, "process_changed") &&
      !isNullableProcessChanged(process_changed)
    ) {
      return NextResponse.json(
        { error: "process_changed 값은 boolean 또는 null이어야 합니다." },
        { status: 400 }
      );
    }
    const initialProcessChanged = getInitialProcessChanged(
      process_changed,
      Object.prototype.hasOwnProperty.call(formValues, "process_changed"),
      business_category
    );
    const requestedStatus = normalizeTargetBusinessStatus(is_registered);
    const initialRegistrationStatus = resolveTargetBusinessStatusForCreate(
      requestedStatus,
      Boolean(measurementSchedule.measurement_date)
    );

    // 2. Insert into measurement_target_business
    const { data: newTarget, error: insertError } = await supabase
      .from("measurement_target_business")
      .insert({
        code,
        year: Number(year),
        period,
        business_name,
        business_number: String(business_number || "").replace(/\D/g, "") || null,
        address: address || null,
        office_jurisdiction: resolveOfficeJurisdiction(
          office_jurisdiction,
          calculatedOfficeJurisdiction
        ),
        business_category: business_category || null,
        business_type: business_type ?? null,
        process_changed: initialProcessChanged,
        phone: phone || null,
        fax: fax || null,
        invoice_email: invoice_email || null,
        manager_name: manager_name || null,
        manager_mobile: manager_mobile || null,
        manager_phone: manager_phone || null,
        total_employees: normalizedTotalEmployees,
        manager_email: normalizedManagerEmail,
        plan_manager: plan_manager || null,
        management_status: management_status || null,
        notes: notes || null,
        national_support_status: initialSupportState.nationalSupportStatus,
        sync_status: initialSupportState.syncStatus,
        sync_error_message: null,
        industrial_accident_number: industrialAccidentNumber,
        commencement_number: commencementNumber,
        representative_name: representative_name || null,
        measurement_date: measurementSchedule.measurement_date,
        measurement_end_date: measurementSchedule.measurement_end_date,
        daily_staff: measurementSchedule.daily_staff,
        measurer_id: measurementSchedule.measurer_id,
        link_measurer_id: link_measurer_id ?? null,
        collaborators: measurementSchedule.collaborators,
        future_measurement_period: future_measurement_period ?? null,
        future_measurement_date: future_measurement_date || null,
        document_generation_enabled: true,
        is_registered: initialRegistrationStatus,
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "이미 등록된 사업장입니다 (코드/년도/주기 중복)." },
          { status: 409 }
        );
      }
      throw new Error(`Target Insert Error: ${insertError.message}`);
    }

    try {
      await syncCreatedTargetMeasurementSchedule(supabase, {
        code,
        year: Number(year),
        period: String(period),
        businessName: String(business_name),
        targetId: Number(newTarget.id),
        targetStatus: initialRegistrationStatus,
        days: measurementDays,
      });
    } catch (scheduleSyncError) {
      // PATCH와 동일하게 target 저장은 유지하고 legacy 일정/Calendar 후속 처리 실패만 기록한다.
      console.error("[Integrated Sync] 신규 사업장 일정 후속 처리 실패:", scheduleSyncError);
    }

    let geocodeResult = null;
    try {
      geocodeResult = await ensureBusinessCoordinate(supabase, {
        code,
        businessName: business_name,
        fallbackAddress: address,
      });
    } catch (coordinateError) {
      console.error(
        "[BusinessCoordinates] 신규 등록 후 좌표 처리 실패:",
        coordinateError instanceof Error ? coordinateError.message : "unknown"
      );
    }

    return NextResponse.json({
      success: true,
      businessCreated: true,
      data: newTarget,
      geocodeStatus: geocodeResult?.geocoding_status?.toLowerCase() || "failed",
      latitude: geocodeResult?.latitude ?? null,
      longitude: geocodeResult?.longitude ?? null,
      geocodeMessage: geocodeResult?.geocoding_error || undefined,
      documentGenerationEnabled: true,
      documentGenerationJobId: null,
      nationalSupportFollowUp: {
        eligible: initialSupportState.shouldQueueLookup,
        mode: initialSupportState.shouldAutoApply ? "apply_if_missing" : "lookup_only",
        status: initialSupportState.syncStatus,
      },
    });
  } catch (error: any) {
    console.error("POST API Critical Error:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error?.message || String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await checkPermission("journal:write");

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "삭제할 ID가 제공되지 않았습니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Delete from measurement_target_business
    const { error } = await supabase
      .from("measurement_target_business")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Delete Target Error:", error);
      return NextResponse.json(
        { error: "삭제 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, message: "삭제되었습니다." });

  } catch (error: any) {
    console.error("DELETE API Critical Error:", error);
    return NextResponse.json({
      error: "Internal Server Error",
      details: error?.message || String(error)
    }, { status: 500 });
  }
}
