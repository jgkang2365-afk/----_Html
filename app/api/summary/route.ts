
import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { toShortName } from "@/lib/constants/designated-offices";
import { buildPreliminarySurveyDisplayModel, measurementRolesForDisplay } from "@/lib/preliminary-survey-v2/display-model";

/**
 * 측정정보 요약 조회 API
 * 측정일지와 예비조사 정보를 조인하여 반환
 * GET /api/summary
 */
export async function GET(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const measurementYear = searchParams.get("measurementYear")?.trim() || null;
    const measurementPeriod = searchParams.get("measurementPeriod")?.trim() || null;
    const businessName = searchParams.get("businessName")?.trim() || null;
    const designatedOffice = searchParams.get("designatedOffice")?.trim() || null;

    const supabase = await createClient();

    // 측정일지 조회
    let journalQuery = supabase
      .from("measurement_journal")
      .select("*")
      .not("business_name", "ilike", "%번외%");

    // 정렬 적용
    if (!measurementYear) {
      // 년도 전체일 때: 시간 역순 (년도 DESC, 주기 DESC, 등록순 DESC)
      journalQuery = journalQuery
        .order("measurement_year", { ascending: false })
        .order("measurement_period", { ascending: false })
        .order("document_number", { ascending: false })
        .order("created_at", { ascending: false });
    } else {
      // 년도 선택 시: 기존 정렬 유지
      journalQuery = journalQuery
        .order("document_number", { ascending: false })
        .order("measurement_year", { ascending: false })
        .order("measurement_period", { ascending: false })
        .order("created_at", { ascending: false });
    }

    // 검색 조건 적용
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

    // 측정일 (측정시작일 기준)
    const measurementDate = searchParams.get("measurementDate")?.trim() || null;
    if (measurementDate) {
      journalQuery = journalQuery.eq("measurement_start_date", measurementDate);
    }

    const { data: journals, error: journalError } = await journalQuery;

    if (journalError) {
      console.error("측정일지 조회 오류:", journalError);
      return NextResponse.json(
        { error: "측정정보를 불러오는 중 오류가 발생했습니다.", details: journalError.message },
        { status: 500 }
      );
    }

    // 측정일지의 code 목록 추출
    const codes = (journals || [])
      .map((j: any) => j.code)
      .filter((code: string | null) => code !== null && code !== undefined);

    // 예비조사 정보 조회 (code 기준)
    let surveys: any[] = [];
    if (codes.length > 0) {
      const { data: surveyData, error: surveyError } = await supabase
        .from("preliminary_survey")
        .select("id, code, year, period, measurement_date, end_date, measurement_weekdays, preliminary_surveyor, measurer, actual_measurer, report_writer, survey_code, created_at")
        .in("code", codes)
        .order("measurement_date", { ascending: true });

      if (surveyError) {
        console.error("예비조사 조회 오류:", surveyError);
        // 예비조사 조회 실패해도 계속 진행
      } else {
        surveys = surveyData || [];
      }
    }

    // 측정사업장 정보 조회 (요약 수정 API와 양방향 동기화되는 담당자/계산서 정보)
    let measurementBusinesses: any[] = [];
    if (codes.length > 0) {
      let { data: mbData, error: mbError } = await supabase
        .from("measurement_business")
        .select("code, year, period, representative_name, total_employees, industrial_accident_number, phone, fax, commencement_number, manager_name, manager_position, manager_mobile, manager_phone, manager_email, invoice_email")
        .in("code", codes)
        .order("year", { ascending: false })
        .order("period", { ascending: false });

      if (mbError && (mbError.message?.includes("manager_phone") || mbError.code === "PGRST204")) {
        const fallbackResult = await supabase
          .from("measurement_business")
          // 레거시 스키마에서도 보장된 기존 필드로 재시도한다.
          .select("code, year, period, representative_name, commencement_number, manager_name, manager_position, manager_mobile, manager_email, invoice_email")
          .in("code", codes)
          .order("year", { ascending: false })
          .order("period", { ascending: false });

        mbData = fallbackResult.data?.map((row) => ({
          ...row,
          total_employees: null,
          industrial_accident_number: null,
          phone: null,
          fax: null,
          manager_phone: null,
        })) || null;
        mbError = fallbackResult.error;
      }

      if (mbError) {
        console.warn("측정사업장 조회 오류 (개시번호 및 담당자):", mbError);
      } else {
        measurementBusinesses = mbData || [];
      }
    }

    // 측정사업장 맵 생성: 현재 연도/주기 정확 매칭을 우선하고, 없을 때만 코드별 최신 이력을 사용
    const mbExactMap = new Map<string, any>();
    const mbLatestMap = new Map<string, any>();
    measurementBusinesses.forEach((mb) => {
      if (mb.code) {
        mbExactMap.set(`${mb.code}-${mb.year}-${mb.period}`, mb);
        if (!mbLatestMap.has(mb.code)) {
          mbLatestMap.set(mb.code, mb);
        }
      }
    });

    // 사업장 정보(business_info) 조회 (대표자명과 근로자수 보완)
    let businessInfos: any[] = [];
    if (codes.length > 0) {
      let { data: biData, error: biError } = await supabase
        .from("business_info")
        .select("code, representative_name, total_employees")
        .in("code", codes);

      if (biError) {
        console.warn("사업장 정보 조회 오류 (대표자명):", biError);
      } else {
        businessInfos = biData || [];
      }
    }

    // code를 키로 하는 사업장 정보 맵 생성
    const biMap = new Map<string, any>();
    businessInfos.forEach((bi) => {
      if (bi.code) {
        biMap.set(bi.code, bi);
      }
    });

    // 2026-02-06 Fix: Fetch measurement_target_business for national_support_status
    let targets: any[] = [];
    if (codes.length > 0) {
      const { data: targetData, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("id, code, year, period, national_support_status, measurement_date, plan_manager, collaborators, daily_staff, measurer_id")
        .in("code", codes);

      if (targetError) {
        console.error("대상 사업장 조회 오류:", targetError);
        return NextResponse.json(
          { error: "측정대상사업장 원천을 불러오지 못했습니다.", details: targetError.message },
          { status: 500 },
        );
      }
      targets = targetData || [];
    }

    // 예비조사 정보를 조인하여 요약 데이터 생성
    const normalizePhoneLikeValue = (value: any, managerName?: any) => {
      const text = String(value || "").trim();
      if (!text) return null;

      const nameText = String(managerName || "").trim();
      const digitCount = (text.match(/\d/g) || []).length;
      const containsKorean = /[가-힣]/.test(text);

      if (nameText && text === nameText) return null;
      if (containsKorean && digitCount < 7) return null;
      if (digitCount > 0 && digitCount < 7) return null;

      return text;
    };

    const findFirstPhoneLikeValue = (managerName: any, ...values: any[]) => {
      for (const value of values) {
        const normalized = normalizePhoneLikeValue(value, managerName);
        if (normalized) return normalized;
      }
      return null;
    };

    const hasValue = (value: any) =>
      value !== null && value !== undefined && String(value).trim() !== "";

    const targetExactMap = new Map<string, any>();
    targets.forEach((target) => {
      if (target.code) {
        targetExactMap.set(`${target.code}-${target.year}-${target.period}`, target);
      }
    });

    const targetIds = targets.map((target) => Number(target.id)).filter(Number.isInteger);
    const { data: v2Plans, error: v2PlanError } = targetIds.length
      ? await supabase.from("preliminary_survey_v2_plans").select(
        "id, measurement_target_business_id, recommended_date, participant_user_ids, participant_names",
      ).in("measurement_target_business_id", targetIds)
      : { data: [], error: null };
    if (v2PlanError) {
      console.error("예비조사 V2 계획 표시 원천 조회 오류:", v2PlanError);
      return NextResponse.json(
        { error: "예비조사 V2 계획 원천을 불러오지 못했습니다.", details: v2PlanError.message },
        { status: 500 },
      );
    }
    const planIds = (v2Plans ?? []).map((plan: any) => String(plan.id));
    const { data: v2Assignments, error: v2AssignmentError } = planIds.length
      ? await supabase.from("preliminary_survey_v2_measurement_assignments").select(
        "plan_id, measurement_date, assignee_user_id, survey_code, public_sample_code",
      ).in("plan_id", planIds)
      : { data: [], error: null };
    if (v2AssignmentError) {
      console.error("예비조사 V2 공시료 배정 표시 원천 조회 오류:", v2AssignmentError);
      return NextResponse.json(
        { error: "예비조사 V2 공시료 배정 원천을 불러오지 못했습니다.", details: v2AssignmentError.message },
        { status: 500 },
      );
    }
    const displayUserIds = new Set<number>();
    targets.forEach((target) => {
      const roles = measurementRolesForDisplay({
        dailyStaff: target.daily_staff,
        measurementDate: target.measurement_date,
        measurerId: target.measurer_id,
        collaborators: target.collaborators,
      });
      if (roles.reportWriterUserId != null) displayUserIds.add(roles.reportWriterUserId);
    });
    (v2Assignments ?? []).forEach((assignment: any) => {
      const assigneeId = Number(assignment.assignee_user_id);
      if (Number.isInteger(assigneeId)) displayUserIds.add(assigneeId);
    });
    (v2Plans ?? []).forEach((plan: any) => {
      const participantIds = Array.isArray(plan.participant_user_ids) ? plan.participant_user_ids : [];
      participantIds.forEach((id: unknown) => {
        const participantId = Number(id);
        if (Number.isInteger(participantId)) displayUserIds.add(participantId);
      });
    });
    const { data: users, error: userError } = displayUserIds.size
      ? await supabase.from("users").select("id, name, is_preliminary_survey_experienced").in("id", [...displayUserIds])
      : { data: [], error: null };
    if (userError) {
      console.error("예비조사 V2 표시 사용자 조회 오류:", userError);
      return NextResponse.json(
        { error: "예비조사 V2 표시 사용자 원천을 불러오지 못했습니다.", details: userError.message },
        { status: 500 },
      );
    }
    const v2PlanByTarget = new Map((v2Plans ?? []).map((plan: any) => [Number(plan.measurement_target_business_id), plan]));
    const v2AssignmentsByPlanDate = new Map((v2Assignments ?? []).map((assignment: any) => [
      `${assignment.plan_id}|${assignment.measurement_date}`, assignment,
    ]));
    const userNameById = new Map((users ?? []).map((user: any) => [Number(user.id), String(user.name ?? "")]));
    const userById = new Map((users ?? []).map((user: any) => [Number(user.id), user]));

    const summaryData = (journals || []).map((journal: any) => {
      const exactKey = `${journal.code}-${journal.measurement_year}-${journal.measurement_period}`;
      const mb = journal.code ? (mbExactMap.get(exactKey) || mbLatestMap.get(journal.code)) : null;
      const bi = journal.code ? biMap.get(journal.code) : null;
      const exactTarget = journal.code ? targetExactMap.get(exactKey) : null;

      // 해당 코드의 모든 예비조사 필터링 (다중 일자 지원을 위해 목록 전체 유지)
      const businessSurveys = surveys.filter(s => s.code === journal.code);

      // 측정일의 월이 아니라 저장된 년도/주기로 연결한다.
      // 반기 경계 밖의 일정도 사용자가 지정한 업무 주기에 그대로 포함되어야 한다.
      const relatedSurveys = businessSurveys.filter(s => {
        const surveyPeriod = String(s.period || "").replace("(수시)", "").trim();
        const journalPeriod = String(journal.measurement_period || "").replace("(수시)", "").trim();

        return Number(s.year) === Number(journal.measurement_year) && surveyPeriod === journalPeriod;
      });

      // legacy fallback도 현재 측정일 정확 일치를 우선하고, 없으면 기존 최신 원천을 쓴다.
      const survey = relatedSurveys.find((item) => item.measurement_date === journal.measurement_start_date)
        ?? relatedSurveys.at(-1)
        ?? null;

      // Find target for National Support Status fallback
      let target = exactTarget;

      // 2. Loose match (if strictly not found) - handle "(수시)" etc.
      if (!target) {
        target = targets.find(t =>
          t.code === journal.code &&
          t.year === journal.measurement_year &&
          (t.period.includes(journal.measurement_period) || journal.measurement_period.includes(t.period))
        );
      }

      const nationalSupportStatus = journal.national_support_status || target?.national_support_status || null;
      // 역할 표시 원천은 반드시 해당 년도·주기의 exact target만 사용한다.
      // code-only/다른 주기 target fallback은 국고지원 보완에만 허용하고 역할 값에는 사용하지 않는다.
      const displayTarget = exactTarget;
      const v2Plan: any = displayTarget ? v2PlanByTarget.get(Number(displayTarget.id)) : null;
      const displayMeasurementDate = displayTarget?.measurement_date || journal.measurement_start_date || null;
      const measurementRoles = displayTarget ? measurementRolesForDisplay({
        dailyStaff: displayTarget.daily_staff,
        measurementDate: displayTarget.measurement_date,
        measurerId: displayTarget.measurer_id,
        collaborators: displayTarget.collaborators,
      }) : { measurementParticipants: [], reportWriterUserId: null };
      const v2PlanAssignments = v2Plan
        ? (v2Assignments ?? [])
          .filter((assignment: any) => String(assignment.plan_id) === String(v2Plan.id))
          .sort((left: any, right: any) => String(left.measurement_date).localeCompare(String(right.measurement_date)))
        : [];
      const v2Assignment: any = v2PlanAssignments.find(
        (assignment: any) => assignment.measurement_date === displayMeasurementDate,
      ) ?? v2PlanAssignments[0] ?? null;
      const participantIds = Array.isArray(v2Plan?.participant_user_ids)
        ? v2Plan.participant_user_ids.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
        : [];
      const v2SurveyorUsers = participantIds
        .map((id: number) => userById.get(id))
        .filter(Boolean)
        .map((user: any) => ({
          name: user.name,
          isExperienced: user.is_preliminary_survey_experienced,
        }));
      const reportWriter = measurementRoles.reportWriterUserId == null
        ? null
        : userNameById.get(Number(measurementRoles.reportWriterUserId));
      const legacySurvey = relatedSurveys.find((item: any) => item.measurement_date === displayMeasurementDate)
        ?? relatedSurveys.at(-1)
        ?? null;
      const preliminaryDisplay = buildPreliminarySurveyDisplayModel({
        v2: v2Plan ? {
          preliminarySurveyDate: v2Plan.recommended_date,
          preliminarySurveyors: v2Plan.participant_names,
          preliminarySurveyorUsers: v2SurveyorUsers,
          measurementPublicSampleAssignee: v2Assignment
            ? userNameById.get(Number(v2Assignment.assignee_user_id))
            : null,
          publicSampleCode: v2Assignment?.public_sample_code ?? v2Assignment?.survey_code,
          measurementPublicSampleAssignments: v2PlanAssignments.map((assignment: any) => ({
            measurementDate: assignment.measurement_date,
            assignee: userNameById.get(Number(assignment.assignee_user_id)),
            publicSampleCode: assignment.public_sample_code ?? assignment.survey_code,
          })),
          measurementParticipants: measurementRoles.measurementParticipants,
          reportWriter,
        } : null,
        legacy: !v2Plan && legacySurvey ? {
          preliminarySurveyDate: null,
          preliminarySurveyors: legacySurvey.preliminary_surveyor,
          measurementPublicSampleAssignee: legacySurvey.measurer,
          publicSampleCode: legacySurvey.survey_code,
          measurementParticipants: displayTarget
            ? measurementRoles.measurementParticipants
            : legacySurvey.actual_measurer,
          reportWriter: displayTarget ? reportWriter : legacySurvey.report_writer,
        } : null,
      });
      // 요약 수정 API가 measurement_business에도 저장하는 필드만 최신 동기화 원본을 우선한다.
      // 그 외 일지 고유 필드는 스냅샷을 유지해 저장 직후 이전 값으로 되돌아 보이지 않게 한다.
      const reference = mb ? {
        representative_name: mb.representative_name || null,
        total_employees: hasValue(mb.total_employees) ? mb.total_employees : null,
        industrial_accident_number: mb.industrial_accident_number || null,
        phone: mb.phone || null,
        fax: mb.fax || null,
        manager_name: mb.manager_name || null,
        manager_position: mb.manager_position || null,
        manager_mobile: findFirstPhoneLikeValue(mb.manager_name, mb.manager_mobile, mb.manager_phone),
        manager_email: mb.manager_email || null,
        invoice_email: mb.invoice_email || null,
      } : {
        representative_name: bi?.representative_name || null,
        total_employees: null,
        industrial_accident_number: null,
        phone: null,
        fax: null,
      };
      const managerName = reference.manager_name || journal.manager_name || null;

      return {
        id: journal.id,
        journal_id: journal.id,
        survey_id: survey?.id || null,
        all_surveys: relatedSurveys, // [New] 연관된 모든 예비조사 목록 추가
        code: journal.code,
        measurement_year: journal.measurement_year,
        measurement_period: journal.measurement_period,
        note: journal.note,
        document_number: journal.document_number,
        sequence_number: journal.sequence_number,
        five_plus_sequence: journal.five_plus_sequence,
        measurement_start_date: journal.measurement_start_date,
        measurement_end_date: journal.measurement_end_date,
        measurement_days: journal.measurement_days,
        measurer: journal.measurer,
        preliminary_display: preliminaryDisplay,
        public_sample_measurer: preliminaryDisplay.measurementPublicSampleAssignee === "-" ? null : preliminaryDisplay.measurementPublicSampleAssignee,
        preliminary_surveyor: survey?.preliminary_surveyor || null,
        actual_measurer: survey?.actual_measurer || null,
        report_writer: survey?.report_writer || null,
        survey_code: survey?.survey_code || null,
        survey_measurement_date: survey?.measurement_date || null,
        survey_end_date: survey?.end_date || null,
        survey_measurement_weekdays: survey?.measurement_weekdays || null,
        office_jurisdiction: journal.office_jurisdiction,
        designated_office: journal.designated_office ? toShortName(journal.designated_office) : null,
        business_name: journal.business_name,
        representative_name: reference.representative_name || journal.representative_name || null,
        total_employees: (() => {
          const val = hasValue(reference.total_employees)
            ? reference.total_employees
            : (hasValue(journal.total_employees) ? journal.total_employees : bi?.total_employees);
          if (val === null || val === undefined) return null;
          const num = typeof val === 'string' ? parseInt(val.replace(/,/g, "")) : val;
          return isNaN(num as any) ? val : num;
        })(),
        business_number: journal.business_number,
        industrial_accident_number: reference.industrial_accident_number || journal.industrial_accident_number,
        commencement_number: journal.commencement_number || mb?.commencement_number || null,
        national_support_status: nationalSupportStatus,
        manager_name: managerName,
        manager_position: reference.manager_position || journal.manager_position || null,
        manager_mobile: reference.manager_mobile || findFirstPhoneLikeValue(managerName, journal.manager_mobile),
        manager_email: reference.manager_email || journal.manager_email || null,
        invoice_email: reference.invoice_email || journal.invoice_email || null,
        invoice_email_2: journal.invoice_email_2,
        address: journal.address,
        phone: reference.phone || journal.phone,
        fax: reference.fax || journal.fax,
        k2b_send_date: journal.k2b_send_date,
        k2b_sender: journal.k2b_sender,
        electronic_invoice_date: journal.electronic_invoice_date,
        electronic_invoice_date_2: journal.electronic_invoice_date_2,
        deposit_amount_business: journal.deposit_amount_business,
        deposit_date_business: journal.deposit_date_business,
        deposit_amount_business_2: journal.deposit_amount_business_2,
        deposit_date_business_2: journal.deposit_date_business_2,
        measurement_fee_business: journal.measurement_fee_business,
        measurement_fee_national: journal.measurement_fee_national,
        special_notes: journal.special_notes,
        completion_status: journal.completion_status,
        designated_office_report_status: journal.designated_office_report_status || "미접수",
        target_measurement_date: target?.measurement_date || null,
        plan_manager: target?.plan_manager || null,
        created_at: journal.created_at,
        updated_at: journal.updated_at,
      };
    });

    // 보고서 담당자 필터링 (메모리 상에서 처리)
    const reportWriter = searchParams.get("reportWriter")?.trim() || null;
    let finalData = summaryData;

    if (reportWriter) {
      finalData = finalData.filter((item: any) => item.report_writer === reportWriter);
    }

    return NextResponse.json({
      success: true,
      data: finalData,
      count: finalData.length,
    });
  } catch (error: any) {
    console.error("측정정보 요약 조회 오류:", error);
    return NextResponse.json(
      { error: error.message || "측정정보를 불러오는 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
