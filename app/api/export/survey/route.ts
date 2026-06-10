import { NextRequest, NextResponse } from "next/server";
export const dynamic = 'force-dynamic';
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import * as XLSX from "xlsx";

/**
 * 예비조사 목록 엑셀 다운로드 API
 * GET /api/export/survey
 */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("survey:read");

    const supabase = await createClient();

    // 예비조사 목록 조회 (순번 기준 오름차순 정렬)
    const { data: surveys, error } = await supabase
      .from("preliminary_survey")
      .select("*")
      .order("sequence_number", { ascending: true, nullsFirst: false });

    if (error) {
      console.error("예비조사 목록 조회 오류:", error);
      return NextResponse.json(
        { error: "예비조사 목록 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // 엑셀 데이터 준비
    const excelData = (surveys || []).map((survey) => ({
      순번: survey.sequence_number || "",
      코드: survey.code || "",
      측정일: survey.measurement_date || "",
      종료일: survey.end_date || "",
      측정요일: survey.measurement_weekdays || "",
      사업장명: survey.business_name || "",
      측정자: survey.measurer || "",
      공시료코드: survey.survey_code || "",
      주소: survey.address || "",
      예비조사자: survey.preliminary_surveyor || "",
      실측정자: survey.actual_measurer || "",
      보고서담당: survey.report_writer || "",
      생성일시: survey.created_at
        ? new Date(new Date(survey.created_at).getTime() + 9 * 60 * 60 * 1000).toISOString().replace("T", " ").split(".")[0]
        : "",
      수정일시: survey.updated_at
        ? new Date(new Date(survey.updated_at).getTime() + 9 * 60 * 60 * 1000).toISOString().replace("T", " ").split(".")[0]
        : "",
    }));

    // 엑셀 워크북 생성
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "예비조사목록");

    // 엑셀 파일 생성
    const excelBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    // 파일명 생성
    const fileName = `예비조사목록_${new Date().toISOString().split("T")[0]}.xlsx`;

    return new NextResponse(excelBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    console.error("예비조사 엑셀 다운로드 오류:", error);
    return NextResponse.json(
      {
        error: "엑셀 다운로드 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
