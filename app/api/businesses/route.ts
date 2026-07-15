/**
 * 측정 대상 사업장 조회 API
 * GET /api/businesses
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = 'force-dynamic'; // Force dynamic rendering

import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { toShortName } from "@/lib/constants/designated-offices";
import { normalizeAddress, normalizeString } from "@/lib/utils/data-utils";
import { createSurveyEvent, updateSurveyEvent, deleteSurveyEvent, getSurveyEvent } from "@/lib/google/calendar";
import { syncBusinessToCalendar } from "@/lib/google/sync-service";
import { findOfficeByAddress } from "@/lib/utils/jurisdiction-matcher";
import { normalizeBusinessStatus } from "@/lib/utils/sync-helper";
import { syncToMasterTables } from "@/lib/sync/master-tables";

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

    // 향후 측정주기 및 최신 사업장 정보 (measurement_business 테이블에서 최신값 조회)
    // 1순위: measurement_business
    const { data: latestBusinessData } = await supabase
      .from("measurement_business")
      .select("code, year, period, future_measurement_period, business_number, total_employees, phone, business_category")
      .in("code", codes)
      .order("year", { ascending: false })
      .order("period", { ascending: false });

    // 2순위: measurement_journal
    const { data: latestJournalData } = await supabase
      .from("measurement_journal")
      .select("code, measurement_year, measurement_period, business_number, total_employees, phone, business_category")
      .in("code", codes)
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false });

    // 3순위 보완: 사업장정보(business_info)에만 있는 기본 사업자등록번호
    const { data: businessInfoData } = await supabase
      .from("business_info")
      .select("code, business_number")
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
      const jInfo = journalInfoMap.get(item.code);
      const basicInfo = businessBasicInfoMap.get(item.code);

      // 실시여부 로직: 기 입력된 값이 '거래종료', '종료', '실시', '미실시' 등 정규화된 값이면 유지.
      // 그 외(null 등)의 경우 기본값('미실시')으로 처리
      let isRegisteredText = normalizeBusinessStatus(item.is_registered);

      // 향후 측정주기 로직: 최신값 우선, 없으면 현재 값
      const futurePeriod = bInfo?.future_measurement_period || item.future_measurement_period;

      // [New Sync Priority Logic - Refined]
      // 1. 업종분류 & 국고지원: 측정대상(Target) 테이블이 권위 있는 소스이나, 기입된 정보가 없거나 기본값("공업사")인 경우 최신 정보로 보완
      let businessCategory = item.business_category;
      if (!businessCategory || businessCategory === "공업사" || businessCategory === "선택") {
        businessCategory = bInfo?.business_category || jInfo?.business_category || item.business_category;
      }

      let nationalSupportStatus = item.national_support_status;
      if (!nationalSupportStatus) {
        nationalSupportStatus = bInfo?.national_support_status || jInfo?.national_support_status || item.national_support_status;
      }

      // 2. 사업자번호, 근로자수, 연락처, 대표자명: 측정사업장/일지 최신값 우선.
      // 사업장정보(business_info)에만 사업자번호가 있는 기존 자료도 빈값으로 보이지 않도록 보완합니다.
      // (measurement_business(bInfo) > measurement_journal(jInfo) > business_info(basicInfo) > target(item))
      const businessNumber = bInfo?.business_number || jInfo?.business_number || basicInfo?.business_number || item.business_number;
      const totalEmployees = bInfo?.total_employees || jInfo?.total_employees || item.total_employees;
      const phone = bInfo?.phone || jInfo?.phone || item.manager_phone;
      const representativeName = bInfo?.representative_name || jInfo?.representative_name || item.representative_name;

      const industrialAccidentNumber = bInfo?.industrial_accident_number || jInfo?.industrial_accident_number || item.industrial_accident_number;
      const commencementNumber = bInfo?.commencement_number || jInfo?.commencement_number || item.commencement_number;


      return {
        ...item,
        unpaid_count: businessCount, // 사업장 미수 (Calculated)
        national_unpaid_count: nationalCount, // 국고 미수 (Calculated)
        unpaid_details: filteredDetails, // Filtered details
        // UI 호환성을 위한 필드 매핑
        designated_office: item.office_jurisdiction, // 임시 매핑
        isRegistered: isRegisteredText === "실시", // Frontend 호환성
        is_registered_text: isRegisteredText, // 텍스트 값 전달
        future_measurement_period: futurePeriod, // 최신 값으로 덮어쓰기

        // Sync Applied Fields
        business_number: businessNumber,
        total_employees: totalEmployees,
        manager_phone: phone,
        business_category: /^\d+$/.test(String(businessCategory)) ? `⚠️ 수정필요(${businessCategory})` : businessCategory,
        national_support_status: nationalSupportStatus,
        representative_name: representativeName,
        industrial_accident_number: industrialAccidentNumber,
        commencement_number: commencementNumber,
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
    if (updates.hasOwnProperty('measurement_date')) {
      let bQuery = supabase.from("measurement_target_business").select("measurement_date, business_name");
      if (id) {
        bQuery = bQuery.eq("id", id);
      } else if (code && year && period) {
        bQuery = bQuery.eq("code", code).eq("year", year).eq("period", period);
      }
      const { data: oldData } = await bQuery.maybeSingle();
      if (oldData) {
        existingDate = oldData.measurement_date;
        businessNameForNote = oldData.business_name;
      }
    }

    const allowedUpdateColumns = new Set([
      "business_name", "business_category", "address", "office_jurisdiction",
      "is_registered", "national_support_status", "plan_manager", "manager_name",
      "manager_mobile", "phone", "management_status", "notes", "measurement_date",
      "measurement_end_date", "future_measurement_period", "future_measurement_date",
      "measurer_id", "period", "collaborators", "daily_staff", "representative_name",
      "industrial_accident_number", "commencement_number",
    ]);
    const updatePayload: any = Object.fromEntries(
      Object.entries(updates).filter(([key]) => allowedUpdateColumns.has(key))
    );
    updatePayload.updated_at = new Date().toISOString();

    // [The Joo Rule] 수동 업데이트 시에도 숫자형 업종분류 차단
    if (updates.business_category && /^\d+$/.test(String(updates.business_category))) {
      console.warn(`[API] 수동 숫자 업종분류 차단됨: ${updates.business_category}`);
      delete updatePayload.business_category; // 잘못된 데이터는 무시하고 다른 필드만 저장
    }

    // [New Feature] Auto-calculate office_jurisdiction if address is being updated
    if (updates.hasOwnProperty('address')) {
      const office = findOfficeByAddress(updates.address);
      if (office) {
        updatePayload.office_jurisdiction = office;
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
        // daily_staff가 명시적으로 null이면 모든 일정을 삭제하라는 의미다.
        const hasDailyStaffUpdate = Object.prototype.hasOwnProperty.call(updates, "daily_staff");
        let dailyStaff = hasDailyStaffUpdate
          ? (Array.isArray(updates.daily_staff) ? updates.daily_staff : [])
          : undefined;
        
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
              measurement_date: entry.date,
              end_date: entry.date,
              report_writer: reportWriterName,
              actual_measurer: actualMeasurer,
              business_name: updates.business_name || updatedData.business_name
            };

            const existing = existingSurveys?.find(s => s.measurement_date === entry.date);
            if (existing) {
              await supabase.from("preliminary_survey").update(surveyPayload).eq("id", existing.id);
            } else {
              const { data: maxSeq } = await supabase.from("preliminary_survey").select("sequence_number").order("sequence_number", { ascending: false }).limit(1).maybeSingle();
              const nextSeq = (maxSeq?.sequence_number || 0) + 1;
              await supabase.from("preliminary_survey").insert({ ...surveyPayload, code, year, period, sequence_number: nextSeq });
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

    return NextResponse.json({ success: true, data: updatedData });

  } catch (error: any) {
    console.error("PATCH API Critical Error:", error);
    return NextResponse.json({
      error: "Internal Server Error",
      details: error?.message || String(error)
    }, { status: 500 });
  }
}
export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");

    const body = await request.json();
    const { 
      code, 
      year, 
      period, 
      business_name, 
      address, 
      plan_manager, 
      national_support_status,
      sanjae,
      commencement,
      representative_name
    } = body;

    // Validation
    if (!code || !year || !period || !business_name) {
      return NextResponse.json(
        { error: "필수 정보가 누락되었습니다. (코드, 년도, 주기, 사업장명)" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 1. 중복 확인 (measurement_target_business)
    // 단, 주기에 '(수시)'가 포함된 경우 중복 허용 (여러 번 수시 측정 가능)
    if (!period.includes("(수시)")) {
      const { data: existing } = await supabase
        .from("measurement_target_business")
        .select("id")
        .eq("code", code)
        .eq("year", year)
        .eq("period", period)
        .maybeSingle();

      if (existing) {
        return NextResponse.json(
          { error: "이미 등록된 사업장입니다 (코드/년도/주기 중복)." },
          { status: 409 }
        );
      }
    }

    // Auto-calculate office_jurisdiction based on address
    const officeJurisdiction = address ? findOfficeByAddress(address) : null;

    // 2. Insert into measurement_target_business
    const { data: newTarget, error: insertError } = await supabase
      .from("measurement_target_business")
      .insert({
        code,
        year: Number(year),
        period,
        business_name,
        address: address || null,
        office_jurisdiction: officeJurisdiction, // 자동 할당
        plan_manager: plan_manager || null,
        national_support_status: national_support_status || null,
        industrial_accident_number: sanjae || null,
        commencement_number: commencement || null,
        representative_name: representative_name || null,
        is_registered: "미실시", // Default
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Target Insert Error: ${insertError.message}`);
    }

    return NextResponse.json({ success: true, data: newTarget });

  } catch (error: any) {
    console.error("POST API Critical Error:", error);
    return NextResponse.json({
      error: "Internal Server Error",
      details: error?.message || String(error)
    }, { status: 500 });
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
