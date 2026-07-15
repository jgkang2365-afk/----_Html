import { createSurveyEvent, updateSurveyEvent, deleteSurveyEvent, getSurveyEvent, listEvents } from "./calendar";
import { SupabaseClient } from "@supabase/supabase-js";
import { resolveCalendarColorId } from "./calendar-policy";

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
    // [잠시 중단] 캘린더 동기화 기능을 잠시 중단합니다. (필요 시 true -> false로 변경)
    const IS_DISABLED = false;
    if (IS_DISABLED) {
        console.log(`[Sync Service] Calendar sync is temporarily disabled. Skipping ${code}.`);
        return { success: true, message: "Calendar sync disabled" };
    }

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
    let syncedEventCount = 0;

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

      const { data: currentJournal, error: journalError } = await supabase
            .from("measurement_journal")
            .select("k2b_send_date, electronic_invoice_date, measurement_fee_business")
            .eq("code", code)
            .eq("measurement_year", survey.year)
            .eq("measurement_period", survey.period)
            .maybeSingle();
      if (journalError) throw journalError;

      const colorId = resolveCalendarColorId(survey.report_writer, currentJournal);

      const eventData = {
        summary,
        description: `
          사업장코드: ${code}
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
          const updated = await updateSurveyEvent(survey.google_event_id, eventData);
          if (updated) {
            if (updated.colorId !== colorId) {
              throw new Error(`캘린더 색상 검증 실패: 요청 ${colorId}, 저장 ${updated.colorId || "없음"}`);
            }
            syncedEventCount += 1;
          } else {
            const created = await createSurveyEvent(eventData);
            if (!created?.id) throw new Error("삭제된 캘린더 일정을 다시 생성하지 못했습니다.");
            await supabase.from("preliminary_survey").update({ google_event_id: created.id }).eq("id", survey.id);
            survey.google_event_id = created.id;
            syncedEventCount += 1;
          }
        } else {
          const created = await createSurveyEvent(eventData);
          if (!created?.id) throw new Error("캘린더 일정을 다시 생성하지 못했습니다.");
          await supabase.from("preliminary_survey").update({ google_event_id: created.id }).eq("id", survey.id);
          survey.google_event_id = created.id;
          syncedEventCount += 1;
        }
      } else {
        const created = await createSurveyEvent(eventData);
        if (!created?.id) throw new Error("캘린더 일정을 생성하지 못했습니다.");
        await supabase.from("preliminary_survey").update({ google_event_id: created.id }).eq("id", survey.id);
        survey.google_event_id = created.id;
        syncedEventCount += 1;
      }
    }

    // 5. [중요] target_business 테이블의 google_event_id 관리 및 고아 이벤트(Orphans) 청소
    const surveyEventIds = validSurveys.map(s => s.google_event_id).filter(Boolean);
    
    // target_business에 저장된 이전 방식의 이벤트 ID가 있다면 정리
    if (targetBiz.google_event_id && !surveyEventIds.includes(targetBiz.google_event_id)) {
        await deleteSurveyEvent(targetBiz.google_event_id);
        await supabase.from("measurement_target_business").update({ google_event_id: null }).eq("id", targetBiz.id);
    }

    // [The Joo Rule] Successful Null: DB에 없는 찌꺼기 이벤트 전수 조사 및 제거
    try {
        const timeMin = `${yearNum}-01-01T00:00:00Z`;
        const timeMax = `${yearNum}-12-31T23:59:59Z`;
        
        // 사업장 명칭으로 1차 필터링하여 조회 (성능 최적화)
        const allCalendarEvents = await listEvents(timeMin, timeMax, targetBiz.business_name);
        console.log(`[Sync Service] Reconciliation: Found ${allCalendarEvents.length} relevant events for "${targetBiz.business_name}" in ${yearNum}`);

        const orphanEvents = allCalendarEvents.filter((event: any) => {
            const hasName = event.summary?.includes(targetBiz.business_name);
            const isSystem = event.description?.includes("사업장:") || event.summary?.trim().startsWith("[");
            const isNotId = !surveyEventIds.includes(event.id);
            const hasSameCode = event.description && event.description.includes(`사업장코드: ${code}`);
            
            if (hasName && isSystem && isNotId && hasSameCode) {
                console.log(`[Sync Service] Identified Orphan: "${event.summary}" (ID: ${event.id})`);
                return true;
            }
            return false;
        });

        if (orphanEvents.length > 0) {
            console.log(`[Sync Service] Found ${orphanEvents.length} orphan events for ${targetBiz.business_name} in ${yearNum}. Cleaning up...`);
            for (const orphan of orphanEvents) {
                if (orphan.id) {
                    await deleteSurveyEvent(orphan.id);
                }
            }
        }
    } catch (reconcileErr) {
        console.error("[Sync Service] Reconciliation error:", reconcileErr);
    }

    if (validSurveys.length === 0) {
        console.log(`[Sync Service] Successful Null: No surveys remain for ${code}. Calendar cleanup complete.`);
    }

    console.log(`[Sync Service] Sync completed for ${code}`);
    return { success: true, count: validSurveys.length, syncedEventCount };
  } catch (error) {
    console.error(`[Sync Service] Exception for ${code}:`, error);
    throw error;
  }
}
