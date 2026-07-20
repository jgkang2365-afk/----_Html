import { NextRequest, NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

type Template = {
  fileName: string;
  sheetName: string;
  headers: string[];
  example: (string | number)[];
  widths?: number[];
};

const templates: Record<string, Template> = {
  "national-support": {
    fileName: "건강디딤돌_업로드_양식.xlsx",
    sheetName: "건강디딤돌 신청결과",
    headers: [
      "사업장관리번호", "사업개시번호", "사업장명", "대표자",
      "주소(필수 값 아님)", "담당자", "휴대전화번호\n(010 제외한 번호만 입력)",
      "신청 여부", "신청결과", "사업장코드",
    ],
    example: ["", "", "예시 사업장", "홍길동", "", "", "", "○", "대상", "H0138"],
    widths: [20, 18, 24, 14, 32, 14, 24, 12, 12, 14],
  },
  "measurement-target": {
    fileName: "측정대상사업장_등록양식.xlsx",
    sheetName: "측정대상사업장",
    headers: [
      "사업장코드", "측정년도", "측정주기", "사업장명", "주소", "업종",
      "담당자", "계획담당자", "휴대폰", "전화번호", "팩스",
      "산재번호", "사업개시번호", "대표자명", "관할청",
      "전회측정일", "향후측정주기", "비고",
    ],
    example: ["H0138", new Date().getFullYear(), "상반기", "예시 사업장", "", "", "", "", "", "", "", "", "", "", "", "", "6개월", ""],
  },
  journal: {
    fileName: "측정일지_업로드_양식.xlsx",
    sheetName: "측정일지 등록현황",
    headers: [
      "코드*", "측정년도*", "측정주기*", "비고", "지정한계_관할지청*",
      "공문연번", "연번", "5인 이상 연번", "측정시작일", "측정종료일",
      "완료여부", "측정자", "소재지 관할청", "사업장명*", "총인원",
      "사업자번호", "산재보험번호", "대표자명", "국고지원여부", "주소",
      "전화번호", "팩스번호", "담당자명", "담당자직책", "담당자휴대폰",
      "담당자이메일", "K2B 전송일", "K2B 전송자", "계산서 이메일",
      "전자계산서 발행일", "측정비(합계)", "측정비(사업장)", "측정비(국고)",
      "입금액(합계)", "입금일(사업장)", "입금액(사업장)", "입금일(국고)",
      "입금액(국고)", "특이사항",
    ],
    example: ["H0138", new Date().getFullYear(), "상반기", "", "천안", "", "", "", "", "", "", "", "", "예시 사업장"],
  },
  sales: {
    fileName: "측정비_입금정보_업로드_양식.xlsx",
    sheetName: "입금정보 일괄업로드",
    headers: [
      "코드(필수)", "측정년도(필수)", "측정주기(필수)", "사업장명(참고용)",
      "측정비(사업장)", "입금일(사업장)", "입금액(사업장)", "측정비(국고)",
      "입금일(국고)", "입금액(국고)", "전자계산서 발행일", "계산서 이메일",
      "발행처 상호(변경)", "발행처 사업자(변경)",
    ],
    example: ["H0433", new Date().getFullYear(), "상반기", "예시 사업장", 150000, "", "", 300000, "", "", "", "", "", ""],
  },
};

export async function GET(request: NextRequest) {
  try {
    await checkPermission("journal:read");

    const templateKey = new URL(request.url).pathname.split("/").filter(Boolean).pop() || "";
    const template = templates[templateKey];
    if (!template) {
      return NextResponse.json({ error: "요청한 양식을 찾을 수 없습니다." }, { status: 404 });
    }

    const example = Array.from({ length: template.headers.length }, (_, index) => template.example[index] ?? "");
    const worksheet = XLSX.utils.aoa_to_sheet([template.headers, example]);
    worksheet["!cols"] = template.headers.map((header, index) => ({
      wch: template.widths?.[index] ?? Math.min(Math.max(header.length + 4, 12), 24),
    }));
    worksheet["!rows"] = [{ hpt: 32 }];
    worksheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(template.headers.length - 1)}2` };

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, template.sheetName);
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(template.fileName)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("양식 다운로드 오류:", error);
    return NextResponse.json({ error: "양식 다운로드 중 오류가 발생했습니다." }, { status: 500 });
  }
}
