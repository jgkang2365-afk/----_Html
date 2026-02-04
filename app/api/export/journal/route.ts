import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import * as XLSX from "xlsx";

/**
 * 측정일지 등록 현황 엑셀 다운로드 API
 * GET /api/export/journal
 */
export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");

    const { searchParams } = new URL(request.url);
    const year = searchParams.get("year");
    const period = searchParams.get("period");

    const supabase = await createClient();

    // 측정일지 목록 조회
    let query = supabase
      .from("measurement_journal")
      .select("*")
      .order("measurement_year", { ascending: false })
      .order("measurement_period", { ascending: false })
      .order("code", { ascending: true });

    if (year) {
      query = query.eq("measurement_year", parseInt(year));
    }

    if (period) {
      // 상반기 선택 시 상반기(수시)도 포함되도록 like 검색으로 변경
      query = query.like("measurement_period", `${period}%`);
    }

    const { data: journals, error } = await query;

    if (error) {
      console.error("측정일지 목록 조회 오류:", error);
      return NextResponse.json(
        { error: "측정일지 목록 조회 중 오류가 발생했습니다." },
        { status: 500 }
      );
    }

    // 엑셀 데이터 준비 (업로드 양식과 동일한 순서 및 필드명)
    const excelData = (journals || []).map((journal) => ({
      "코드*": journal.code || "",
      "측정년도*": journal.measurement_year || "",
      "측정주기*": journal.measurement_period || "",
      비고: journal.note || "",
      "지정한계_관할지청*": journal.designated_office || "",
      공문연번: journal.document_number || "",
      연번: journal.sequence_number || "",
      "5인 이상 연번": journal.five_plus_sequence || "",
      측정시작일: journal.measurement_start_date || "",
      측정종료일: journal.measurement_end_date || "",
      완료여부: journal.completion_status || "",
      측정자: journal.measurer || "",
      "소재지 관할청": journal.office_jurisdiction || "",
      "사업장명*": journal.business_name || "",
      총인원: journal.total_employees || "",
      사업자번호: journal.business_number || "",
      산재보험번호: journal.industrial_accident_number || "",
      대표자명: journal.representative_name || "",
      국고지원여부: journal.national_support_status || "",
      주소: journal.address || "",
      전화번호: journal.phone || "",
      팩스번호: journal.fax || "",
      담당자명: journal.manager_name || "",
      담당자직책: journal.manager_position || "",
      담당자휴대폰: journal.manager_mobile || "",
      담당자이메일: journal.manager_email || "",
      "K2B 전송일": journal.k2b_send_date || "",
      "K2B 전송자": journal.k2b_sender || "",
      "계산서 이메일": journal.invoice_email || "",
      "전자계산서 발행일": journal.electronic_invoice_date || "",
      "측정비(합계)": journal.measurement_fee_total || "",
      "측정비(사업장)": journal.measurement_fee_business || "",
      "측정비(국고)": journal.measurement_fee_national || "",
      "입금액(합계)": journal.deposit_total || "",
      "입금일(사업장)": journal.deposit_date_business || "",
      "입금액(사업장)": journal.deposit_amount_business || "",
      "입금일(국고)": journal.deposit_date_national || "",
      "입금액(국고)": journal.deposit_amount_national || "",
      특이사항: journal.special_notes || "",
    }));

    // 엑셀 워크북 생성
    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "측정일지등록현황");

    // 엑셀 파일 생성
    const excelBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    // 파일명 생성
    const fileName = `측정일지등록현황_${year || "전체"}_${period || "전체"}_${new Date().toISOString().split("T")[0]}.xlsx`;

    return new NextResponse(excelBuffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
      },
    });
  } catch (error) {
    console.error("측정일지 엑셀 다운로드 오류:", error);
    return NextResponse.json(
      {
        error: "엑셀 다운로드 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
