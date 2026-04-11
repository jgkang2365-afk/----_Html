import { createSurveyEvent, updateSurveyEvent, deleteSurveyEvent, getSurveyEvent } from "./calendar";
import { SupabaseClient } from "@supabase/supabase-js";

/**
 * 특정 사업장의 정보를 구글 캘린더와 동기화합니다.
 * (System-as-Master 방식)
 * 
 * @param supabase Supabase 클라이언트
 * @param code 사업장 코드
 * @param year 측정년도
 * @param period 측정주기
 */
export async function syncBusinessToCalendar(
  supabase: SupabaseClient,
  code: string,
  year: number | string,
  period: string
) {
    const yearNum = typeof year === 'string' ? parseInt(year) : (year || 0);
    const periodStr = period || "";

    console.log(`[Sync Service] Starting sync for ${code} (${yearNum}/${periodStr})...`);

    try {

    // 1. 사업장 정보(Target Business) 조회
    const { data: targetBiz, error: targetError } = await supabase
      .from("measurement_target_business")
      .select("*")
      .eq("code", code)
      .eq("year", yearNum)
      .eq("period", periodStr)
      .maybeSingle();

    if (targetError || !targetBiz) {
      console.log(`[Sync Service] No target found or error:`, targetError);
      return null;
    }

    const isConfirmedStatus = targetBiz.is_registered === "확정" || targetBiz.is_registered === "실시";

    // 2. 예비조사 레코드 전체 조회 (다중 일정 처리용)
    const { data: surveys, error: surveyError } = await supabase
      .from("preliminary_survey")
      .select("*")
      .eq("code", code)
      .eq("year", yearNum)
      .eq("period", periodStr);

    if (surveyError) {
      console.error(`[Sync Service] Survey fetch error:`, surveyError);
    }

    const validSurveys = surveys || [];
    console.log(`[Sync Service] Found ${validSurveys.length} survey dates for ${code}`);

    // 3. 미수 정보 조회 (공통)
    let unpaidText = "";
    try {
      const { data: journalData } = await supabase
        .from("measurement_journal")
        .select("measurement_year, measurement_period, measurement_fee_business, deposit_amount_business, deposit_amount_business_2")
        .eq("code", code);

      if (journalData && journalData.length > 0) {
        const unpaidPeriods: string[] = [];
        journalData.forEach((j: any) => {
          const feeBiz = Number(j.measurement_fee_business || 0);
          const depBiz = Number(j.deposit_amount_business || 1); // 0원 처리 고려
          if (feeBiz - (Number(j.deposit_amount_business || 0) + Number(j.deposit_amount_business_2 || 0)) > 0) {
            const yr = String(j.measurement_year).slice(-2);
            unpaidPeriods.push(`${yr}${j.measurement_period === "상반기" ? "상" : "하"}`);
          }
        });
        if (unpaidPeriods.length > 0) unpaidText = `${unpaidPeriods.join("/")} 미수`;
      }
    } catch (e) {
      console.error("[Sync Service] Unpaid query error:", e);
    }

    // 4. 각 일정별 동기화 수행
    const colorMap: { [key: string]: string } = {
      '한기문': '10', '배윤민': '6', '강종구': '9', '이주형': '5', '고유빈': '7',
    };

    for (const survey of validSurveys) {
      if (!isConfirmedStatus || !survey.measurement_date) {
        // 확정이 아니거나 날짜가 없으면 이벤트 삭제
        if (survey.google_event_id) {
          await deleteSurveyEvent(survey.google_event_id);
          await supabase.from("preliminary_survey").update({ google_event_id: null }).eq("id", survey.id);
        }
        continue;
      }

      // 제목 생성: 담당자가 측정자에 포함 → [담당자, 측정자...] / 미포함 → [측정자...(담당자)]
      let staffDisplay = "미지정";
      const measurers = survey.actual_measurer ? survey.actual_measurer.split(',').map((m: string) => m.trim()).filter(Boolean) : [];
      const writer = survey.report_writer ? survey.report_writer.trim() : "";
      const writerInMeasurers = writer && measurers.includes(writer);
      
      if (measurers.length > 0) {
        if (writerInMeasurers) {
          // 담당자가 측정자에 포함됨 → 맨 앞 정렬, 괄호 생략
          const others = measurers.filter((m: string) => m !== writer);
          staffDisplay = [writer, ...others].join(", ");
        } else if (writer) {
          // 담당자가 측정자에 미포함 → 뒤에 (담당자) 표시
          staffDisplay = `${measurers.join(", ")}(${writer})`;
        } else {
          staffDisplay = measurers.join(", ");
        }
      } else {
        staffDisplay = writer ? `(${writer})` : "미지정";
      }
      
      const notesText = targetBiz.notes || "";
      const baseSummary = `[${staffDisplay}] ${targetBiz.business_name}`;
      const suffixParts = [unpaidText, notesText].filter(Boolean);
      const summary = baseSummary + (suffixParts.length > 0 ? ` - ${suffixParts.join(" / ")}` : "");

      // 색상 결정 (보고서 담당자 기준)
      let colorId = colorMap[survey.report_writer] || '10';

      // K2B/인보이스 상태 체크 (생략 가능하나 기존 로직 유지)
      try {
          const { data: currentJournal } = await supabase
            .from("measurement_journal")
            .select("k2b_send_date, electronic_invoice_date, measurement_fee_business")
            .eq("code", code)
            .eq("measurement_year", survey.year)
            .eq("measurement_period", survey.period)
            .maybeSingle();

          if (currentJournal?.k2b_send_date && (currentJournal.electronic_invoice_date || Number(currentJournal.measurement_fee_business) === 0)) {
            colorId = '3'; // Grape (완료)
          }
      } catch (e) {}

      const eventData = {
        summary,
        description: `
          사업장: ${targetBiz.business_name}
          주소: ${targetBiz.address || "주소 미입력"}
          담당자: ${targetBiz.manager_name || "미지정"}
          연락처: ${targetBiz.manager_mobile || targetBiz.phone || "없음"}
          비고: ${targetBiz.notes || ""}
        `.trim(),
        date: survey.measurement_date,
        endDate: survey.end_date || survey.measurement_date,
        location: targetBiz.address || "",
        colorId
      };

      if (survey.google_event_id) {
        const existing = await getSurveyEvent(survey.google_event_id);
        if (existing && existing.status !== 'cancelled') {
          await updateSurveyEvent(survey.google_event_id, eventData);
        } else {
          const created = await createSurveyEvent(eventData);
          if (created?.id) await supabase.from("preliminary_survey").update({ google_event_id: created.id }).eq("id", survey.id);
        }
      } else {
        const created = await createSurveyEvent(eventData);
        if (created?.id) await supabase.from("preliminary_survey").update({ google_event_id: created.id }).eq("id", survey.id);
      }
    }

    // 5. [중요] target_business 테이블의 google_event_id 관리 (첫 번째 일정으로 동기화 또는 삭제)
    // 기존 시스템 호환성을 위해 target_business의 이벤트 ID는 삭제하거나 첫 번째 일정의 ID로 대체 고려
    if (targetBiz.google_event_id) {
        // 기존 단일 이벤트가 survey_ids 중 하나가 아니라면 삭제 (중복 방지)
        const surveyEventIds = validSurveys.map(s => s.google_event_id).filter(Boolean);
        if (!surveyEventIds.includes(targetBiz.google_event_id)) {
            await deleteSurveyEvent(targetBiz.google_event_id);
            await supabase.from("measurement_target_business").update({ google_event_id: null }).eq("id", targetBiz.id);
        }
    }

    console.log(`[Sync Service] Sync completed for ${code}`);
    return { success: true, count: validSurveys.length };
  } catch (error) {
    console.error(`[Sync Service] Exception for ${code}:`, error);
    throw error;
  }
}
