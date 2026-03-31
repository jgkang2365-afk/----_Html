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
  try {
    console.log(`[Sync Service] Starting sync for ${code} (${year}/${period})...`);

    // 1. 사업장 정보(Target Business) 조회
    const { data: targetBiz, error: targetError } = await supabase
      .from("measurement_target_business")
      .select("*")
      .eq("code", code)
      .eq("year", typeof year === 'string' ? parseInt(year) : year)
      .eq("period", period)
      .maybeSingle();

    if (targetError || !targetBiz) {
        console.log(`[Sync Service] No target found or error:`, targetError);
        return null;
    }

    const isConfirmedStatus = targetBiz.is_registered === "확정" || targetBiz.is_registered === "실시";
    const needsCalendarSync = isConfirmedStatus || !!targetBiz.google_event_id;

    if (!needsCalendarSync) {
      console.log(`[Sync Service] No sync required (Status=${targetBiz.is_registered}, EventID=${targetBiz.google_event_id})`);
      return null;
    }

    const hasRequiredInfo = !!targetBiz.measurement_date;
    const eventId = targetBiz.google_event_id;

    const mDate = targetBiz.measurement_date;
    const isTargetDate = mDate === "2026-01-12" || (mDate && mDate >= "2026-02-23");

    console.log(`[Sync Service] Check: Confirmed=${isConfirmedStatus}, HasInfo=${hasRequiredInfo}, IsTargetDate=${isTargetDate}, EventID=${eventId}`);

    // 조건 1: 확정/실시 상태이고 필수 정보(날짜)가 있으며 타겟 날짜인 경우 -> 생성/수정
    if (isConfirmedStatus && hasRequiredInfo && isTargetDate) {
      
      // 담당자 이름 조회
      let measurerName = targetBiz.plan_manager || "미지정";
      if (targetBiz.measurer_id) {
        const { data: userData } = await supabase
          .from("users")
          .select("name")
          .eq("id", targetBiz.measurer_id)
          .single();
        if (userData) measurerName = userData.name;
      }

      // 미수 정보 조회
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
            const depBiz = Number(j.deposit_amount_business || 0);
            const depBiz2 = Number(j.deposit_amount_business_2 || 0);
            if (feeBiz - (depBiz + depBiz2) > 0) {
              const yr = String(j.measurement_year).slice(-2);
              const pd = j.measurement_period === "상반기" ? "상" : j.measurement_period === "하반기" ? "하" : j.measurement_period;
              unpaidPeriods.push(`${yr}${pd}`);
            }
          });
          if (unpaidPeriods.length > 0) unpaidText = `${unpaidPeriods.join("/")} 미수`;
        }
      } catch (e) {
        console.error("[Sync Service] Unpaid query error:", e);
      }

      // 보고서 담당자 + 협력자 조합
      let namesDisplay = measurerName;
      let surveyEndDate: string | undefined;
      try {
        // 1. 측정 대상 사업장의 협력자 정보 우선 확인
        const collaborators = targetBiz.collaborators ? targetBiz.collaborators.split(",").map((m: string) => m.trim()).filter(Boolean) : [];
        
        // 2. 예비조사 테이블의 실측정자 정보 보완 (기존 데이터 호환용)
        const { data: surveyData } = await supabase
          .from("preliminary_survey")
          .select("actual_measurer, end_date")
          .eq("code", code)
          .eq("year", typeof year === 'string' ? parseInt(year) : year)
          .eq("period", period)
          .maybeSingle();

        const actualList = surveyData?.actual_measurer ? surveyData.actual_measurer.split(",").map((m: string) => m.trim()) : [];
        
        // 중복 제거 및 합치기 (담당자 + 협력자 + 실측정자)
        const allNames = new Set([measurerName, ...collaborators, ...actualList]);
        const namesArray = Array.from(allNames).filter(Boolean);
        
        if (namesArray.length > 0) {
          namesDisplay = namesArray.join(", ");
        }

        if (surveyData?.end_date && surveyData.end_date !== targetBiz.measurement_date) {
          surveyEndDate = surveyData.end_date;
        }
      } catch (e) {
        console.error("[Sync Service] Survey/Collaborator query error:", e);
      }

      // 최종 제목 및 설명 조합
      const notesText = targetBiz.notes || "";
      const baseSummary = `[${namesDisplay}]${targetBiz.business_name}`;
      const suffixParts = [unpaidText, notesText].filter(Boolean);
      const suffix = suffixParts.length > 0 ? ` - ${suffixParts.join(" / ")}` : "";
      const summary = baseSummary + suffix;

      const description = `
        사업장: ${targetBiz.business_name}
        주소: ${targetBiz.address || "주소 미입력"}
        담당자: ${targetBiz.manager_name || "미지정"}
        연락처: ${targetBiz.manager_mobile || targetBiz.phone || "없음"}
        비고: ${targetBiz.notes || ""}
      `.trim();

      // Color Mapping (담당자 기준)
      const colorMap: { [key: string]: string } = {
        '한기문': '10', // Basil
        '배윤민': '6',  // Tangerine
        '강종구': '9',  // Blueberry
        '이주형': '5',  // Banana
        '고유빈': '7',  // Peacock
      };
      let colorId = colorMap[measurerName];

      // K2B 및 세금계산서 완료 체크 (포도색)
      try {
        const { data: currentJournal } = await supabase
          .from("measurement_journal")
          .select("k2b_send_date, electronic_invoice_date, measurement_fee_business")
          .eq("code", code)
          .eq("measurement_year", typeof year === 'string' ? parseInt(year) : year)
          .eq("measurement_period", period)
          .maybeSingle();

        const feeBiz = Number(currentJournal?.measurement_fee_business || 0);
        const hasK2B = !!currentJournal?.k2b_send_date;
        const hasInvoice = !!currentJournal?.electronic_invoice_date;

        // 포도색(3) 조건: K2B 발송일이 있고, (전자계산서 발행일이 있거나 측정비(사업장)가 0원인 경우)
        if (hasK2B && (hasInvoice || feeBiz === 0)) {
          colorId = '3'; // Grape
          console.log(`[Sync Service] Completed status for ${code}. Color -> Grape(3). K2B=${currentJournal?.k2b_send_date}, Invoice=${currentJournal?.electronic_invoice_date}, Fee=${feeBiz}`);
        } else {
          console.log(`[Sync Service] Not completed yet for ${code}. Color -> ${colorId}. K2B=${currentJournal?.k2b_send_date}, Invoice=${currentJournal?.electronic_invoice_date}, Fee=${feeBiz}`);
        }
      } catch (e) {
        console.error("[Sync Service] Status check error:", e);
      }

      const eventData = {
        summary,
        description,
        date: targetBiz.measurement_date,
        endDate: surveyEndDate,
        location: targetBiz.address || "",
        colorId
      };

      if (eventId) {
        // 구글 캘린더에서 수동으로 삭제('cancelled')되었는지 확인
        const existingEvent = await getSurveyEvent(eventId);
        
        if (!existingEvent || existingEvent.status === 'cancelled') {
          console.log(`[Sync Service] Event ${eventId} was deleted or not found. Re-creating sequence.`);
          const created = await createSurveyEvent(eventData);
          if (created?.id) {
            await supabase
              .from("measurement_target_business")
              .update({ google_event_id: created.id })
              .eq("id", targetBiz.id);
            console.log(`[Sync Service] Event re-created: ${created.id}`);
            return created;
          }
        } else {
          // 기존 일정이 유효하면 업데이트 수행
          const updated = await updateSurveyEvent(eventId, eventData);
          if (updated) {
            console.log(`[Sync Service] Event updated: ${eventId}`);
            return updated;
          } else {
            // 404 등일 경우 재생성 (Fallback)
            const created = await createSurveyEvent(eventData);
            if (created?.id) {
              await supabase
                .from("measurement_target_business")
                .update({ google_event_id: created.id })
                .eq("id", targetBiz.id);
              console.log(`[Sync Service] Event re-created (fallback): ${created.id}`);
              return created;
            }
          }
        }
      } else {
        const created = await createSurveyEvent(eventData);
        if (created?.id) {
          await supabase
            .from("measurement_target_business")
            .update({ google_event_id: created.id })
            .eq("id", targetBiz.id);
          console.log(`[Sync Service] New event created: ${created.id}`);
          return created;
        }
      }
    }
    // 조건 2: 확정이 아니거나 날짜가 없는데 이벤트가 있는 경우 -> 삭제
    else if ((!isConfirmedStatus || !hasRequiredInfo) && eventId) {
      await deleteSurveyEvent(eventId);
      await supabase
        .from("measurement_target_business")
        .update({ google_event_id: null })
        .eq("id", targetBiz.id);
      console.log(`[Sync Service] Event deleted: ${eventId}`);
      return { deleted: true };
    }

    return null;
  } catch (error) {
    console.error(`[Sync Service] Exception for ${code}:`, error);
    throw error;
  }
}
