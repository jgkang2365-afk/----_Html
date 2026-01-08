/**
 * Excel 파일의 실제 컬럼명 확인 API
 * GET /api/test-excel-columns?file=measurement-business
 * 측정사업장 Excel 파일의 실제 컬럼명을 확인하여 매핑 문제를 진단합니다.
 */

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileType = searchParams.get("file") || "measurement-business";
    
    const fileNameXlsx = fileType === "business-info" ? "사업장정보.xlsx" : "측정사업장.xlsx";
    const fileNameXls = fileType === "business-info" ? "사업장정보.xls" : "측정사업장.xls";
    const filePathXlsx = join(process.cwd(), fileNameXlsx);
    const filePathXls = join(process.cwd(), fileNameXls);
    
    let filePath: string;
    let fileName: string;
    
    if (existsSync(filePathXlsx)) {
      filePath = filePathXlsx;
      fileName = fileNameXlsx;
    } else if (existsSync(filePathXls)) {
      filePath = filePathXls;
      fileName = fileNameXls;
    } else {
      return NextResponse.json(
        { error: `파일을 찾을 수 없습니다: ${fileNameXlsx} 또는 ${fileNameXls}` },
        { status: 404 }
      );
    }

    try {
      const buffer = readFileSync(filePath);
      const workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: true,
      });

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      const range = worksheet["!ref"];
      if (!range) {
        return NextResponse.json({
          error: "데이터가 없습니다",
          file_name: fileName,
        });
      }

      const decodedRange = XLSX.utils.decode_range(range);
      
      // 헤더 읽기 (첫 번째 행)
      const headers: string[] = [];
      for (let col = decodedRange.s.c; col <= decodedRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const cell = worksheet[cellAddress];
        const header = cell ? String(cell.v || "").trim() : "";
        headers.push(header);
      }

      // 첫 번째 데이터 행 샘플
      const firstRowSample: Record<string, any> = {};
      for (let col = decodedRange.s.c; col <= decodedRange.e.c; col++) {
        const headerAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const dataAddress = XLSX.utils.encode_cell({ r: 1, c: col });
        const header = headers[col];
        const dataCell = worksheet[dataAddress];
        const data = dataCell ? dataCell.v : null;
        if (header) {
          firstRowSample[header] = data;
        }
      }

      // 담당자 정보 관련 컬럼 찾기
      const managerColumns = headers.filter(h => 
        h && (
          h.includes("담당자") || 
          h.includes("직위") || 
          h === "BK" || 
          h.includes("BK") || 
          h.includes("Email") || 
          h.includes("이메일") ||
          h.includes("세금") ||
          h.includes("계산서")
        )
      );

      // 산재관리번호 관련 컬럼 찾기
      const industrialAccidentColumns = headers.filter(h => 
        h && h.includes("산재")
      );

      return NextResponse.json({
        success: true,
        file_name: fileName,
        sheet_name: sheetName,
        total_columns: headers.length,
        all_headers: headers,
        first_row_sample: firstRowSample,
        manager_related_columns: managerColumns,
        industrial_accident_columns: industrialAccidentColumns,
        // 매핑 확인
        expected_mappings: {
          manager_name: ["담당자", "담당자명", "담당자 성명"],
          manager_position: ["직위", "담당자 직위"],
          manager_mobile: ["BK", "BK열", "담당자전화", "담당자 휴대폰", "휴대폰"],
          manager_email: ["Email", "이메일", "담당자 e-mail", "담당자 email", "담당자이메일"],
          invoice_email: ["세금 Email", "세금이메일", "계산서 메일", "계산서메일"],
          industrial_accident_number: ["산재관리번호", "산재관리 번호"],
        },
      });
    } catch (parseError) {
      return NextResponse.json(
        {
          error: "Excel 파일 파싱 실패",
          message: parseError instanceof Error ? parseError.message : String(parseError),
          file_name: fileName,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error: "오류 발생",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
