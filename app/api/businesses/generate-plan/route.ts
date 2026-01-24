/**
 * 측정 대상 사업장 계획 생성 API
 * POST /api/businesses/generate-plan
 * 
 * 파라미터:
 * - year: 측정년도 (필수)
 * - period: 측정주기 (필수)
 * 
 * 기능:
 * - 25년 측정일지 데이터를 기준으로 26년 측정 대상 계획을 계산하여 저장
 * - 기존 계획이 있으면 업데이트, 없으면 생성
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { classifyDesignatedOffice, shortNameToFullName, findOfficeByAddress, getDesignatedOfficeByAddress } from "@/lib/utils/jurisdiction-matcher";
import { normalizeAddress, validateDesignatedOffice, normalizeString } from "@/lib/utils/data-utils";

export async function POST(request: NextRequest) {
  try {
    await checkPermission(["journal:write", "journal:read"]);

    const body = await request.json();
    const { year, period } = body;

    if (!year || !period) {
      return NextResponse.json(
        { error: "측정년도와 측정주기는 필수입니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const targetYear = parseInt(year, 10);
    const prevYear = targetYear - 1;

    // 1. 이전 년도 측정일지 데이터 조회
    const { data: prevYearJournals, error: journalPrevYearError } = await supabase
      .from("measurement_journal")
      .select("*")
      .eq("measurement_year", prevYear)
      .in("measurement_period", ["상반기", "하반기"]);

    if (journalPrevYearError) {
      console.error("이전 년도 측정일지 조회 오류:", journalPrevYearError);
      return NextResponse.json(
        { error: "이전 년도 측정일지 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    if (!prevYearJournals || prevYearJournals.length === 0) {
      return NextResponse.json(
        { error: "이전 년도 측정일지 데이터가 없습니다. 계획을 생성할 수 없습니다." },
        { status: 400 }
      );
    }

    // 2. measurement_business에서 향후측정주기 및 담당자(Plan Manager) 정보 확인
    const codesFromPrevYear = new Set<string>();
    prevYearJournals.forEach((item: any) => codesFromPrevYear.add(item.code));

    // measurement_business 테이블에서 향후측정주기 및 담당자 조회
    // 2025년 측정일지와 연결된 measurement_business 레코드에서 가져옴
    const { data: measurementBusinessData, error: mbError } = await supabase
      .from("measurement_business")
      .select("code, year, period, future_measurement_period, measurer")
      .in("code", Array.from(codesFromPrevYear))
      .eq("year", prevYear);

    if (mbError) {
      console.error("측정사업장 조회 오류:", mbError);
    }

    // code + year + period 조합으로 맵 생성 (같은 code에 여러 period가 있을 수 있음)
    // 값: { futurePeriod: number | null, measurer: string | null }
    const measurementBusinessMap = new Map<string, { futurePeriod: number | null, measurer: string | null }>();
    if (measurementBusinessData) {
      measurementBusinessData.forEach((mb: any) => {
        // 같은 code의 여러 period 중 가장 최근 것을 사용 (상반기 < 하반기)
        const key = mb.code;
        const existing = measurementBusinessMap.get(key);

        const newValue = {
          futurePeriod: mb.future_measurement_period || null,
          measurer: mb.measurer || null
        };

        if (!existing && (mb.future_measurement_period || mb.measurer)) {
          measurementBusinessMap.set(key, newValue);
        } else if (mb.future_measurement_period || mb.measurer) {
          // 기존 값이 없거나, 하반기인 경우 업데이트 (더 최신 정보 우선)
          if (mb.period === "하반기" || !existing) {
            measurementBusinessMap.set(key, newValue);
          }
        }
      });
    }

    // 3. 각 코드별로 가장 최근 측정일지만 사용하기 위해 그룹화
    const journalMapByCode = new Map<string, any>();

    prevYearJournals.forEach((journal: any) => {
      const code = journal.code;
      const existing = journalMapByCode.get(code);

      if (!existing) {
        journalMapByCode.set(code, journal);
      } else {
        const existingEndDate = existing.measurement_end_date ? new Date(existing.measurement_end_date).getTime() : 0;
        const existingStartDate = existing.measurement_start_date ? new Date(existing.measurement_start_date).getTime() : 0;
        const existingLatestDate = existingEndDate > existingStartDate ? existingEndDate : existingStartDate;

        const currentEndDate = journal.measurement_end_date ? new Date(journal.measurement_end_date).getTime() : 0;
        const currentStartDate = journal.measurement_start_date ? new Date(journal.measurement_start_date).getTime() : 0;
        const currentLatestDate = currentEndDate > currentStartDate ? currentEndDate : currentStartDate;

        if (currentLatestDate > existingLatestDate) {
          journalMapByCode.set(code, journal);
        }
      }
    });

    // 4. 향후측정주기 기반으로 측정 대상 계획 수립
    const plans: any[] = [];
    let planCount = 0;

    journalMapByCode.forEach((prevYearJournal: any) => {
      const code = prevYearJournal.code;
      const businessInfo = measurementBusinessMap.get(code);
      const futurePeriod = businessInfo?.futurePeriod || null;
      // Plan Manager는 Source (measurement_business)에서 가져옴. 없으면 null.
      // 절대 Journal(Actual Measurer)에서 가져오지 않음.
      const planManager = businessInfo?.measurer || null;

      // 전회 측정일 결정
      let lastMeasurementDate: Date | null = null;
      const endDate = prevYearJournal.measurement_end_date ? new Date(prevYearJournal.measurement_end_date).getTime() : 0;
      const startDate = prevYearJournal.measurement_start_date ? new Date(prevYearJournal.measurement_start_date).getTime() : 0;
      const latestDateStr = endDate > startDate ? prevYearJournal.measurement_end_date : prevYearJournal.measurement_start_date;

      if (latestDateStr) {
        lastMeasurementDate = new Date(latestDateStr);
      }

      // 향후측정주기가 있고 전회 측정일이 있는 경우 계산
      if (futurePeriod && lastMeasurementDate) {
        const nextMeasurementDate = new Date(lastMeasurementDate);
        nextMeasurementDate.setMonth(nextMeasurementDate.getMonth() + futurePeriod);

        const nextYear = nextMeasurementDate.getFullYear();
        const nextMonth = nextMeasurementDate.getMonth() + 1;
        const nextPeriod = nextMonth <= 6 ? "상반기" : "하반기";

        // 목표 년도/반기와 정확히 일치하는지 확인
        if (nextYear === targetYear && nextPeriod === period) {
          // 지정지청 계산
          const address = normalizeAddress(prevYearJournal.address);
          const officeJurisdiction = normalizeString(prevYearJournal.office_jurisdiction);
          let designatedOffice = "천안";

          if (address) {
            try {
              const addressBased = getDesignatedOfficeByAddress(address);
              designatedOffice = validateDesignatedOffice(addressBased) || "천안";
            } catch (error) {
              console.error(`[지정지청] 코드 ${code}: 주소 기반 계산 오류:`, error);
            }
          }

          if (designatedOffice === "천안" && officeJurisdiction) {
            try {
              const officeFullName = shortNameToFullName(officeJurisdiction) || officeJurisdiction;
              const officeBased = classifyDesignatedOffice(officeFullName);
              designatedOffice = validateDesignatedOffice(officeBased) || "천안";
            } catch (error) {
              console.error(`[지정지청] 코드 ${code}: 관할청 기반 계산 오류:`, error);
            }
          }

          plans.push({
            code: code,
            year: targetYear,
            period: period,
            business_name: prevYearJournal.business_name || null,
            business_number: prevYearJournal.business_number || null,
            total_employees: prevYearJournal.total_employees || null,
            address: address,
            office_jurisdiction: officeJurisdiction,
            designated_office: designatedOffice,
            plan_manager: planManager, // Renamed from measurer and using new source
            measurement_start_date: null,
            measurement_end_date: null,
            completion_status: "미완료",
            national_support_status: prevYearJournal.national_support_status || null,
            manager_name: prevYearJournal.manager_name || null,
            manager_mobile: prevYearJournal.manager_mobile || null,
            manager_phone: prevYearJournal.phone || null,
            plan_based_year: prevYear,
            plan_based_period: prevYearJournal.measurement_period,
            future_measurement_period: futurePeriod,
            last_measurement_date: latestDateStr,
            is_registered: false,
          });
          planCount++;
        }
      }
    });

    if (plans.length === 0) {
      return NextResponse.json(
        { error: "해당 년도/반기에 해당하는 측정 대상이 없습니다." },
        { status: 400 }
      );
    }

    // 5. 기존 계획 조회 (업데이트할 항목 확인)
    const codes = plans.map((p) => p.code);
    const { data: existingPlans, error: existingPlansError } = await supabase
      .from("measurement_target_business")
      .select("code, journal_id, is_registered")
      .eq("year", targetYear)
      .eq("period", period)
      .in("code", codes);

    if (existingPlansError) {
      console.error("기존 계획 조회 오류:", existingPlansError);
    }

    const existingPlanMap = new Map<string, { journal_id: number | null; is_registered: boolean }>();
    if (existingPlans) {
      existingPlans.forEach((plan: any) => {
        existingPlanMap.set(plan.code, {
          journal_id: plan.journal_id,
          is_registered: plan.is_registered,
        });
      });
    }

    // 6. 등록된 측정일지 조회 (진행 상황 반영)
    const { data: registeredJournals, error: registeredJournalsError } = await supabase
      .from("measurement_journal")
      .select("id, code, measurement_start_date, measurement_end_date, completion_status, measurer, national_support_status, manager_name, manager_mobile, phone")
      .eq("measurement_year", targetYear)
      .eq("measurement_period", period)
      .in("code", codes);

    if (registeredJournalsError) {
      console.error("등록된 측정일지 조회 오류:", registeredJournalsError);
    }

    const registeredJournalMap = new Map<string, any>();
    if (registeredJournals) {
      registeredJournals.forEach((journal: any) => {
        registeredJournalMap.set(journal.code, journal);
      });
    }

    // 7. 계획 데이터 업데이트 (등록 여부 반영)
    plans.forEach((plan) => {
      const journal = registeredJournalMap.get(plan.code);
      const existing = existingPlanMap.get(plan.code);

      if (journal) {
        plan.journal_id = journal.id;
        plan.is_registered = true;
        plan.registered_at = new Date().toISOString();
        plan.measurement_start_date = journal.measurement_start_date;
        plan.measurement_end_date = journal.measurement_end_date;
        plan.completion_status = journal.completion_status || plan.completion_status;
        // plan.measurer = journal.measurer || plan.measurer; // 원본 계획의 담당자 유지 (측정자 덮어쓰기 방지)
        plan.national_support_status = journal.national_support_status || plan.national_support_status;
        plan.manager_name = journal.manager_name || plan.manager_name;
        plan.manager_mobile = journal.manager_mobile || plan.manager_mobile;
        plan.manager_phone = journal.phone || plan.manager_phone;
      } else if (existing) {
        // 기존 계획이 있고 등록된 측정일지가 있는 경우
        if (existing.journal_id) {
          plan.journal_id = existing.journal_id;
          plan.is_registered = existing.is_registered;
        }
      }
    });

    // 8. UPSERT (기존 항목은 업데이트, 신규 항목은 생성)
    const { data: upsertedPlans, error: upsertError } = await supabase
      .from("measurement_target_business")
      .upsert(plans, {
        onConflict: "code,year,period",
        ignoreDuplicates: false,
      })
      .select();

    if (upsertError) {
      console.error("계획 저장 오류:", upsertError);
      return NextResponse.json(
        { error: "계획 저장 중 오류가 발생했습니다.", details: upsertError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "측정 대상 사업장 계획이 생성/업데이트되었습니다.",
      count: planCount,
      plans: upsertedPlans,
    });
  } catch (error) {
    console.error("계획 생성 API 오류:", error);

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
        error: "계획 생성 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
