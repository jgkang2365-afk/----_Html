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
          const fee = Number(item.measurement_fee_total || 0);
          const deposit = Number(item.deposit_total || 0);
          const unpaidAmount = fee - deposit;

          // Unpaid Business Amount (Split deposit supported)
          const feeBusiness = Number(item.measurement_fee_business || 0);
          const depositBusiness = Number(item.deposit_amount_business || 0);
          const depositBusiness2 = Number(item.deposit_amount_business_2 || 0);
          const unpaidBusiness = feeBusiness - (depositBusiness + depositBusiness2);

          // Unpaid National Amount
          const feeNational = Number(item.measurement_fee_national || 0);
          const depositNational = Number(item.deposit_amount_national || 0);
          const unpaidNational = feeNational - depositNational;

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
      .select("code, measurement_year, measurement_period, business_number, total_employees, phone")
      .in("code", codes)
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false });

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

      // 실시여부 로직: 기 입력된 값이 '거래종료', '종료', '확정', '미확정'이면 유지.
      // 그 외(미실시, null 등)의 경우 예비조사 등록 여부에 따라 판단
      let isRegisteredText = item.is_registered;
      if (item.is_registered !== "거래종료" && item.is_registered !== "종료" && item.is_registered !== "확정" && item.is_registered !== "미확정") {
        isRegisteredText = isSurveyRegistered ? "실시" : "미실시";
      }

      // 향후 측정주기 로직: 최신값 우선, 없으면 현재 값
      const futurePeriod = bInfo?.future_measurement_period || item.future_measurement_period;

      // [Sync Priority]: term (measurement_business) > journal (measurement_journal) > target (original)

      // 사업자등록번호
      const businessNumber = bInfo?.business_number || jInfo?.business_number || item.business_number;
      // 근로자수
      const totalEmployees = bInfo?.total_employees || jInfo?.total_employees || item.total_employees;
      // 유선전화 (Source 'phone' -> Target 'manager_phone' for UI display)
      const phone = bInfo?.phone || jInfo?.phone || item.manager_phone;
      // 업종 (journal에는 없음, business에만 있는 것으로 가정)
      const businessCategory = bInfo?.business_category || item.business_category;


      return {
        ...item,
        unpaid_count: businessCount, // 사업장 미수 (Calculated)
        national_unpaid_count: nationalCount, // 국고 미수 (Calculated)
        unpaid_details: filteredDetails, // Filtered details
        // UI 호환성을 위한 필드 매핑
        designated_office: item.office_jurisdiction, // 임시 매핑
        isRegistered: isRegisteredText === "실시" || isRegisteredText === "확정", // Frontend 호환성
        is_registered_text: isRegisteredText, // 텍스트 값 전달
        future_measurement_period: futurePeriod, // 최신 값으로 덮어쓰기

        // Sync Applied Fields
        business_number: businessNumber,
        total_employees: totalEmployees,
        manager_phone: phone,
        business_category: businessCategory,
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

    const { data: updatedData, error } = await query.select().single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // [New Feature] Sync 'Confirmed Date' to 'Preliminary Survey'
    // If 'measurement_date' is updated
    if (updates.hasOwnProperty('measurement_date') && code && year && period) {
      try {
        if (!updates.measurement_date) {
          // ... (existing logic)
          await supabase
            .from("preliminary_survey")
            .delete()
            .eq("code", code)
            .eq("year", year)
            .eq("period", period);

        } else {
          // ... (existing logic) 
          const { data: existingSurvey } = await supabase
            .from("preliminary_survey")
            .select("id")
            .eq("code", code)
            .eq("year", year)
            .eq("period", period)
            .maybeSingle();

          if (existingSurvey) {
            await supabase
              .from("preliminary_survey")
              .update({ measurement_date: updates.measurement_date })
              .eq("id", existingSurvey.id);

            // [New Feature] Real-time notification if date actually changed
            if (updates.measurement_date !== existingDate) {
              try {
                // Get all journal managers
                const { data: managers } = await supabase
                  .from("users")
                  .select("id")
                  .eq("is_journal_manager", true);

                if (managers && managers.length > 0) {
                  const getKDate = (dateStr: any) => {
                    if (!dateStr) return "미지정";
                    const days = ['일', '월', '화', '수', '목', '금', '토'];
                    const d = new Date(dateStr);
                    return `${dateStr}(${days[d.getDay()]})`;
                  };

                  const notifications = managers.map(m => ({
                    user_id: m.id,
                    message: `[${businessNameForNote}] ${getKDate(existingDate)} → <span class="noti-highlight font-bold text-blue-600">${getKDate(updates.measurement_date)}</span> 변경되었습니다.`,
                    type: "WARNING",
                    related_code: code,
                  }));

                  await supabase.from("notifications").insert(notifications);
                  console.log(`[Notification] Sent to ${managers.length} managers for ${code}`);
                }
              } catch (notiError) {
                console.error("Notification trigger error:", notiError);
              }
            }
          } else {
            const { data: businessInfo } = await supabase
              .from("measurement_target_business")
              .select("business_name, address, office_jurisdiction, measurer_id")
              .eq("code", code)
              .eq("year", year)
              .eq("period", period)
              .single();

            if (businessInfo) {
              // Get report writer name if measurer_id exists
              let reportWriterName = null;
              if (businessInfo.measurer_id) {
                const { data: userData } = await supabase
                  .from("users")
                  .select("name")
                  .eq("id", businessInfo.measurer_id)
                  .single();

                if (userData) {
                  reportWriterName = userData.name;
                }
              }

              // ... (existing sequence logic)
              const { data: maxSeq } = await supabase
                .from("preliminary_survey")
                .select("sequence_number")
                .order("sequence_number", { ascending: false })
                .limit(1)
                .maybeSingle();
              const nextSeq = (maxSeq?.sequence_number || 0) + 1;

              await supabase.from("preliminary_survey").insert({
                year: year,
                period: period,
                code: code,
                measurement_date: updates.measurement_date,
                business_name: businessInfo.business_name,
                address: businessInfo.address,
                sequence_number: nextSeq,
                report_writer: reportWriterName,
                actual_measurer: reportWriterName, // 본인이 직접 실측정자로 우선 들어감.
                created_at: new Date().toISOString()
              });
            }
          }
        }
      } catch (syncError) {
        console.error("Preliminary Survey Sync Error (Date):", syncError);
      }
    }

    // [New Feature] Sync 'Business Name' to 'Preliminary Survey'
    // 사업장명 변경 시 예비조사 테이블의 사업장명도 자동 업데이트
    if (updates.business_name && code && year && period) {
      try {
        const { error: nameSyncError } = await supabase
          .from("preliminary_survey")
          .update({ business_name: updates.business_name })
          .eq("code", code)
          .eq("year", year)
          .eq("period", period);

        if (nameSyncError) {
          console.error("Preliminary Survey Name Sync Error:", nameSyncError);
        } else {
          console.log(`[Sync] Updated preliminary_survey name for ${code} to ${updates.business_name}`);
        }
      } catch (e) {
        console.error("Preliminary Survey Name Sync Exception:", e);
      }
    }

    // [New Feature] Sync 'Report Writer' to 'Preliminary Survey'
    // 측정자(보고서 담당) 변경 시 예비조사 테이블의 작성자(report_writer)와 실측정자(actual_measurer) 자동 업데이트
    if (updates.hasOwnProperty('measurer_id') && code && year && period) {
      try {
        let reportWriterName = null;
        if (updates.measurer_id) {
          const { data: userData } = await supabase
            .from("users")
            .select("name")
            .eq("id", updates.measurer_id)
            .single();

          if (userData) {
            reportWriterName = userData.name;
          }
        }

        // 예비조사의 기존 실측정자 목록 가져오기
        const { data: surveyData } = await supabase
          .from("preliminary_survey")
          .select("actual_measurer")
          .eq("code", code)
          .eq("year", year)
          .eq("period", period)
          .maybeSingle();

        let updatedActualMeasurer = surveyData?.actual_measurer || "";
        if (reportWriterName) {
          const currentMeasurers = updatedActualMeasurer ? updatedActualMeasurer.split(",").map((m: string) => m.trim()) : [];
          if (!currentMeasurers.includes(reportWriterName)) {
            currentMeasurers.push(reportWriterName);
            updatedActualMeasurer = currentMeasurers.join(", ");
          }
        }

        // Update preliminary_survey
        const { error: rwSyncError } = await supabase
          .from("preliminary_survey")
          .update({
            report_writer: reportWriterName,
            actual_measurer: updatedActualMeasurer
          })
          .eq("code", code)
          .eq("year", year)
          .eq("period", period);

        if (rwSyncError) {
          console.error("Preliminary Survey Report Writer Sync Error:", rwSyncError);
        } else {
          console.log(`[Sync] Updated preliminary_survey for ${code}: report_writer=${reportWriterName}, actual_measurer=${updatedActualMeasurer}`);
        }
      } catch (e) {
        console.error("Preliminary Survey Report Writer Sync Exception:", e);
      }
    }

    // [New Feature] System-as-Master Calendar Sync
    if ((updatedData.is_registered === "확정" || updatedData.is_registered === "실시" || !!updatedData.google_event_id) && code && year && period) {
      try {
        await syncBusinessToCalendar(supabase, code, year, period);
        console.log(`[Business Sync] Calendar sync triggered for ${code}`);
      } catch (syncError) {
        console.error(`[Business Sync] Calendar sync failed for ${code}:`, syncError);
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
    const { code, year, period, business_name, address, plan_manager } = body;

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

    // 2. Insert into measurement_target_business
    const { data: newTarget, error: insertError } = await supabase
      .from("measurement_target_business")
      .insert({
        code,
        year: Number(year),
        period,
        business_name,
        address: address || null,
        plan_manager: plan_manager || null,
        is_registered: "미확정", // Default
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Target Insert Error: ${insertError.message}`);
    }

    // 3. Insert into preliminary_survey (Sync)
    // Check sequence number
    const { data: maxSeq } = await supabase
      .from("preliminary_survey")
      .select("sequence_number")
      .order("sequence_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextSeq = (maxSeq?.sequence_number || 0) + 1;

    const { error: surveyError } = await supabase
      .from("preliminary_survey")
      .insert({
        year: Number(year),
        period,
        code,
        business_name,
        address: address || null,
        sequence_number: nextSeq,
        created_at: new Date().toISOString()
      });

    if (surveyError) {
      // Log error but don't fail the whole request (soft sync)
      console.error("Preliminary Survey Auto-Insert Error:", surveyError);
    } else {
      console.log(`[POST] Auto-created preliminary_survey for ${code}`);
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
