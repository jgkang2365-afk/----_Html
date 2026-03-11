import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { reassignSequenceNumbers } from "@/lib/utils/survey-sequence";
import { getKSTISOString } from "@/lib/utils/date-utils";

/**
 * 예비조사 수정/삭제 API
 * PUT: 예비조사 수정
 * DELETE: 예비조사 삭제
 * 
 * 중요: 예비조사 수정은 preliminary_survey 테이블만 업데이트하며,
 * measurement_journal 테이블에는 영향을 주지 않습니다.
 * 두 테이블은 독립적이며, 서로 직접적인 관계가 없습니다.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 권한 체크
    await checkPermission("survey:write");

    const { id } = await params;
    const body = await request.json();
    const {
      year,
      period,
      measurement_date,
      end_date,
      measurement_weekdays,
      code,
      business_name,
      measurer,
      survey_code,
      address,
      preliminary_surveyor,
      actual_measurer,
      report_writer,
    } = body;

    // 필수 필드 검증
    if (!measurement_date || !business_name) {
      return NextResponse.json(
        { error: "측정일과 사업장명은 필수 항목입니다." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 1. 해당 일자 등록 업체 수 제한 (6개 미만이어야 함 -> 6개 이상이면 등록 불가)
    // 수정 시에는 자기 자신(id)은 카운트에서 제외해야 함 (날짜가 바뀌지 않는 경우 등)
    const { count: dateCount, error: dateCountError } = await supabase
      .from("preliminary_survey")
      .select("id", { count: "exact", head: true })
      .eq("measurement_date", measurement_date)
      .neq("id", parseInt(id));

    if (dateCountError) {
      console.error("일자별 등록 건수 조회 오류:", dateCountError);
    } else if ((dateCount || 0) > 6) {
      return NextResponse.json(
        { error: `해당 일자(${measurement_date})에는 이미 6개를 초과하는 업체가 등록되어 있어 변경할 수 없습니다.` },
        { status: 400 }
      );
    }

    // 2. 동일 일자 측정자 중복 체크
    if (measurer) {
      const { data: sameDateSurveys, error: measurerCheckError } = await supabase
        .from("preliminary_survey")
        .select("measurer")
        .eq("measurement_date", measurement_date)
        .neq("id", parseInt(id))
        .not("measurer", "is", null);

      if (measurerCheckError) {
        console.error("측정자 중복 체크 오류:", measurerCheckError);
      } else if (sameDateSurveys && sameDateSurveys.length > 0) {
        const newMeasurers = measurer.split(",").map((m: string) => m.trim());

        for (const survey of sameDateSurveys) {
          if (!survey.measurer) continue;
          const existingMeasurers = survey.measurer.split(",").map((m: string) => m.trim());

          // 교집합 확인
          const duplicates = newMeasurers.filter((nm: string) => existingMeasurers.includes(nm));
          if (duplicates.length > 0) {
            return NextResponse.json(
              { error: `측정자 [${duplicates.join(", ")}]님은 해당 일자(${measurement_date})에 이미 다른 일정(업체)이 배정되어 있습니다.` },
              { status: 400 }
            );
          }
        }
      }
    }

    // 예비조사 수정 (preliminary_survey 테이블만 업데이트, measurement_journal에는 영향 없음)
    const { data: survey, error } = await supabase
      .from("preliminary_survey")
      .update({
        year: year ? parseInt(year) : undefined,
        period: period || undefined,
        measurement_date,
        end_date: end_date || measurement_date,
        measurement_weekdays: measurement_weekdays || null,
        code: code || null,
        business_name,
        measurer: measurer || null,
        survey_code: survey_code || null,
        address: address || null,
        preliminary_surveyor: preliminary_surveyor || null,
        actual_measurer: actual_measurer || null,
        report_writer: report_writer || null,
        updated_at: getKSTISOString(),
      })
      .eq("id", parseInt(id))
      .select()
      .single();

    if (error) {
      console.error("예비조사 수정 오류:", error);
      return NextResponse.json(
        { error: "예비조사 수정 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }
    // 예비조사 수정 후 measurement_journal의 measurer 동기화
    if (code && actual_measurer) {
      const surveyYear = year ? parseInt(year) : null;
      const surveyPeriod = period || null;

      if (surveyYear && surveyPeriod) {
        const { error: journalUpdateError } = await supabase
          .from("measurement_journal")
          .update({ measurer: actual_measurer })
          .eq("code", code)
          .eq("measurement_year", surveyYear)
          .ilike("measurement_period", `%${surveyPeriod.replace('(수시)', '').replace('수시(', '').replace(')', '')}%`);

        if (journalUpdateError) {
          console.error("measurement_journal measurer 동기화 오류:", journalUpdateError);
        }
      }
    }

    // 예비조사 수정 후 measurement_target_business 테이블의 measurement_date 업데이트
    if (code) {
      // 해당 코드의 가장 최근 예비조사의 측정일을 사용
      const { data: latestSurvey, error: latestSurveyError } = await supabase
        .from("preliminary_survey")
        .select("measurement_date")
        .eq("code", code)
        .not("measurement_date", "is", null)
        .order("measurement_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestSurveyError && latestSurvey?.measurement_date) {
        // measurement_target_business 테이블에서 해당 코드의 모든 레코드 업데이트
        const { error: updateError } = await supabase

          .from("measurement_target_business")
          .update({
            measurement_date: latestSurvey.measurement_date,
            business_name: business_name // [New Feature] Sync Business Name
          })
          .eq("code", code);

        if (updateError) {
          console.error("measurement_target_business 측정일 업데이트 오류:", updateError);
          // 오류가 발생해도 예비조사 수정은 성공한 것으로 처리
        }

        // === [Calendar Sync] 예비조사 수정 시 캘린더 이벤트 자동 업데이트 ===
        try {
          const { createSurveyEvent, updateSurveyEvent, getSurveyEvent } = await import("@/lib/google/calendar");

          // 해당 코드의 measurement_target_business 조회
          const { data: targetBiz } = await supabase
            .from("measurement_target_business")
            .select("google_event_id, measurer_id, measurement_date, address, manager_mobile, manager_name, phone, notes, is_registered")
            .eq("code", code)
            .order("year", { ascending: false })
            .limit(1)
            .maybeSingle();

          // [수정] 2026년 2월 23일부터 정식 연동 (1/12은 테스트 완료 건으로 예외 허용)
          const isTargetDate = targetBiz?.measurement_date === "2026-01-12" ||
            (targetBiz?.measurement_date ? new Date(targetBiz.measurement_date) >= new Date("2026-02-23") : false);

          if (targetBiz && targetBiz.google_event_id && targetBiz.is_registered === "확정" && targetBiz.measurement_date && isTargetDate) {
            // 보고서 담당자 조회
            let reportWriterName = "미지정";
            if (targetBiz.measurer_id) {
              const { data: rwUser } = await supabase.from("users").select("name").eq("id", targetBiz.measurer_id).single();
              if (rwUser) reportWriterName = rwUser.name;
            }

            // 실측정자 → 중복 제거하여 표시
            let namesDisplay = reportWriterName;
            if (actual_measurer) {
              const actualList = actual_measurer.split(",").map((m: string) => m.trim());
              const additional = actualList.filter((m: string) => m !== reportWriterName);
              if (additional.length > 0) {
                namesDisplay = `${reportWriterName}, ${additional.join(", ")}`;
              }
            }

            // 미수 정보 조회
            let unpaidText = "";
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

            const notesText = targetBiz.notes || "";
            const baseSummary = `[${namesDisplay}]${business_name}`;
            const suffixParts = [unpaidText, notesText].filter(Boolean);
            const suffix = suffixParts.length > 0 ? ` - ${suffixParts.join(" / ")}` : "";
            const newSummary = baseSummary + suffix;

            // Color mapping (보고서 담당자 기준)
            const colorMap: { [key: string]: string } = { '한기문': '10', '배윤민': '6', '강종구': '9', '이주형': '5', '고유빈': '7' };
            let colorId = colorMap[reportWriterName];

            // [New Feature] K2B 전송 및 계산서 발행 완료 시 '포도(3)' 색상 적용
            try {
              const { data: currentJournal } = await supabase
                .from("measurement_journal")
                .select("k2b_send_date, electronic_invoice_date")
                .eq("code", code)
                .eq("measurement_year", year ? parseInt(year) : null)
                .eq("measurement_period", period || null)
                .maybeSingle();

              if (currentJournal?.k2b_send_date && currentJournal?.electronic_invoice_date) {
                colorId = '3'; // Grape
                console.log(`[Survey->Calendar] Both K2B and Invoice completed for ${code}. Setting color to Grape(3).`);
              }
            } catch (e) {
              console.error("[Survey->Calendar] Status check error:", e);
            }

            const eventData = {
              summary: newSummary,
              description: `사업장: ${business_name}\n주소: ${targetBiz.address || "주소 미입력"}\n담당자: ${targetBiz.manager_name || "미지정"}\n연락처: ${targetBiz.manager_mobile || targetBiz.phone || "없음"}\n비고: ${notesText}`.trim(),
              date: targetBiz.measurement_date,
              endDate: (end_date && end_date !== targetBiz.measurement_date) ? end_date : undefined, // 다일 측정 시
              location: targetBiz.address || "",
              colorId,
            };

            const updated = await updateSurveyEvent(targetBiz.google_event_id, eventData);
            if (updated) {
              console.log(`[Survey->Calendar] Updated event for ${code}: ${newSummary}`);
            } else {
              console.log(`[Survey->Calendar] Update failed for ${code}, trying to re-create...`);
              const newEvent = await createSurveyEvent(eventData);
              if (newEvent && newEvent.id) {
                await supabase.from("measurement_target_business").update({ google_event_id: newEvent.id }).eq("code", code);
                console.log(`[Survey->Calendar] Re-created event: ${newEvent.id}`);
              }
            }
          }
        } catch (calErr) {
          console.error("[Survey->Calendar] Calendar sync error:", calErr);
          // 캘린더 오류가 발생해도 예비조사 수정은 성공으로 처리
        }
      }
    }

    // 순번 재정렬 (측정일 기준)
    await reassignSequenceNumbers(supabase);

    // 재정렬된 최신 정보 조회 (순번이 변경되었을 수 있으므로)
    const { data: updatedSurvey } = await supabase
      .from("preliminary_survey")
      .select("*")
      .eq("id", survey.id)
      .single();

    return NextResponse.json({ survey: updatedSurvey || survey });
  } catch (error) {
    console.error("예비조사 수정 API 오류:", error);

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
        error: "예비조사 수정 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 권한 체크
    await checkPermission("survey:write");

    const { id } = await params;

    const supabase = await createClient();

    // 삭제할 예비조사의 순번 및 코드 조회
    const { data: surveyToDelete, error: selectError } = await supabase
      .from("preliminary_survey")
      .select("sequence_number, code")
      .eq("id", parseInt(id))
      .single();

    if (selectError || !surveyToDelete) {
      return NextResponse.json(
        { error: "삭제할 예비조사를 찾을 수 없습니다.", details: selectError?.message },
        { status: 404 }
      );
    }

    const deletedSequenceNumber = surveyToDelete.sequence_number;
    const deletedCode = surveyToDelete.code;

    // 예비조사 삭제
    const { error } = await supabase
      .from("preliminary_survey")
      .delete()
      .eq("id", parseInt(id));

    if (error) {
      console.error("예비조사 삭제 오류:", error);
      return NextResponse.json(
        { error: "예비조사 삭제 중 오류가 발생했습니다.", details: error.message },
        { status: 500 }
      );
    }

    // 삭제된 순번보다 큰 순번들을 모두 -1 (재정렬) -> 이제 전체 재정렬 로직으로 대체
    // 순번 재정렬 (측정일 기준)
    await reassignSequenceNumbers(supabase);

    // 예비조사 삭제 후 measurement_target_business 테이블의 measurement_date 업데이트
    if (deletedCode) {
      // 해당 코드의 가장 최근 예비조사의 측정일을 사용 (삭제 후 남은 것 중)
      const { data: latestSurvey, error: latestSurveyError } = await supabase
        .from("preliminary_survey")
        .select("measurement_date")
        .eq("code", deletedCode)
        .not("measurement_date", "is", null)
        .order("measurement_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestSurveyError) {
        // measurement_target_business 테이블에서 해당 코드의 모든 레코드 업데이트
        // latestSurvey가 null이면 (더 이상 예비조사가 없으면) measurement_date를 null로 설정
        const { error: updateError } = await supabase
          .from("measurement_target_business")
          .update({
            measurement_date: latestSurvey?.measurement_date || null
          })
          .eq("code", deletedCode);

        if (updateError) {
          console.error("measurement_target_business 측정일 업데이트 오류:", updateError);
          // 오류가 발생해도 예비조사 삭제는 성공한 것으로 처리
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("예비조사 삭제 API 오류:", error);

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
        error: "예비조사 삭제 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
