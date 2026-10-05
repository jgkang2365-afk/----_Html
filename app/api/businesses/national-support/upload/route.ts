import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import * as XLSX from "xlsx";
import { syncNationalSupportToBusiness } from "@/lib/sync/national-support";
import { importRow } from "@/lib/excel-contract/contract";
import { assertNationalSupportPeriod, nationalSupportFields } from "@/lib/excel-contract/national-support";

/**
 * 건강디딤돌 신청 결과 업로드 API
 * POST /api/businesses/national-support/upload
 * 
 * Excel 파일 형식:
 * - 사업장코드: 코드 (예: H0138)
 * - 신청 여부: "○" 또는 기타
 * - 신청결과: "대상", "비대상" 등
 * 
 * 처리 로직:
 * - 신청결과가 "대상"인 경우: national_support_status = "지원"
 * - 신청결과가 "비대상" 또는 기타인 경우: national_support_status = "비대상"
 * - 신청 여부가 없거나 "○"가 아닌 경우: national_support_status = "비대상"
 */

function excelDateToJSDate(excelDate: number): string {
  const excelEpoch = new Date(1899, 11, 30);
  const jsDate = new Date(excelEpoch.getTime() + excelDate * 24 * 60 * 60 * 1000);
  const year = jsDate.getFullYear();
  const month = String(jsDate.getMonth() + 1).padStart(2, "0");
  const day = String(jsDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function POST(request: NextRequest) {
  try {
    await checkPermission("journal:write");

    const formData = await request.formData();
    const file = formData.get("file") as File;
    const year = formData.get("year") as string;
    const period = formData.get("period") as string;

    if (!file) {
      return NextResponse.json(
        { error: "파일을 업로드해주세요." },
        { status: 400 }
      );
    }

    if (!year || !period) {
      return NextResponse.json(
        { error: "측정년도와 측정주기를 입력해주세요." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Excel 파일 읽기
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, {
      type: "buffer",
      cellDates: true,
      cellText: false,
    });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: null });

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: "Excel 파일에 데이터가 없습니다." },
        { status: 400 }
      );
    }

    // Check the whole file before the first write, so a later mismatched row cannot partially apply.
    try {
      data.forEach((row, index) => assertNationalSupportPeriod(row as Record<string, unknown>, year, period, index + 2));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }

    const errors: string[] = [];
    let successCount = 0;
    let updateCount = 0;

    if (!data.some((row) => importRow(nationalSupportFields, row as Record<string, unknown>).code)) {
      return NextResponse.json(
        { error: "Excel 파일에 '코드' 또는 '사업장코드' 컬럼을 찾을 수 없습니다." },
        { status: 400 }
      );
    }

    // 데이터 처리
    for (let i = 0; i < data.length; i++) {
      const row = importRow(nationalSupportFields, data[i] as Record<string, unknown>);
      const code = String(row.code || "").trim();

      if (!code) {
        continue; // 코드가 없으면 스킵
      }

      // 신청 여부 및 신청결과 확인
      const applicationStatus = String(row.application_status || "");
      const result = String(row.result || "");

      // 대표자, 산재번호, 사업개시번호 확인
      const representative = String(row.representative || "");
      const sanjae = String(row.industrial_accident_number || "");
      const commencement = String(row.commencement_number || "");

      // 국고지원 상태 결정
      // 신청결과가 "대상"인 경우: "대상"
      // 그 외: "비대상"
      let nationalSupportStatus: "대상" | "비대상" | null = null;

      if (result && (result === "지원" || result === "지원대상" || result === "대상" || (result.includes("대상") && !result.includes("비대상")))) {
        nationalSupportStatus = "대상";
      } else if (result || applicationStatus) {
        // 신청결과가 있지만 "대상"이 아니면 "비대상"
        nationalSupportStatus = "비대상";
      }
      // 둘 다 없으면 null (업데이트 안 함)

      // 국고지원 상태가 null이면 업데이트하지 않음
      if (nationalSupportStatus === null) {
        continue;
      }

      // national_support_application 테이블에 저장 (간단하게!)
      const { error: upsertError } = await supabase
        .from("national_support_application")
        .upsert({
          code: code,
          year: parseInt(year),
          period: period,
          application_status: applicationStatus || null,
          result: result || null,
          national_support_status: nationalSupportStatus,
          representative_name: representative || null,
          status_source: "confirmed_result",
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'code,year,period'
        });

      if (upsertError) {
        errors.push(`행 ${i + 2}: 코드 ${code} 건강디딤돌 신청결과 저장 실패 - ${upsertError.message}`);
        console.error(`코드 ${code} 저장 오류:`, upsertError);
      } else {
        successCount++;
        updateCount++;
        console.log(`✅ 코드 ${code} (${year} ${period}) 건강디딤돌 신청결과 저장: ${nationalSupportStatus}`);

        // 측정 대상 사업장(measurement_business) 테이블에 국고지원 상태 및 대표자 정보 등 동기화
        await syncNationalSupportToBusiness(
          supabase,
          code,
          parseInt(year),
          period,
          nationalSupportStatus,
          representative || null,
          sanjae || null,
          commencement || null
        );
      }


      // measurement_journal이 있으면 함께 업데이트 (선택사항)
      const { data: journals, error: journalError } = await supabase
        .from("measurement_journal")
        .select("id, code, measurement_year, measurement_period")
        .eq("code", code)
        .eq("measurement_year", parseInt(year))
        .eq("measurement_period", period);

      if (!journalError && journals && journals.length > 0) {
        // 측정일지가 있으면 함께 업데이트
        for (const journal of journals) {
          const { error: updateJournalError } = await supabase
            .from("measurement_journal")
            .update({
              national_support_status: nationalSupportStatus,
              updated_at: new Date().toISOString(),
            })
            .eq("id", journal.id);

          if (updateJournalError && !updateJournalError.message.includes("national_support_status")) {
            errors.push(
              `행 ${i + 2}: 코드 ${code} 측정일지(${journal.id}) 업데이트 실패 - ${updateJournalError.message}`
            );
          }
        }
      }

    }

    return NextResponse.json({
      success: true,
      message: `${successCount}개 사업장 처리 완료 (${updateCount}개 측정일지 업데이트)`,
      processed: successCount,
      updated: updateCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("건강디딤돌 신청 결과 업로드 오류:", error);
    return NextResponse.json(
      {
        error: "업로드 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
