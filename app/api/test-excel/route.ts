/**
 * Excel 파일 구조 확인 API
 * GET /api/test-excel?file=business-info 또는 measurement-business
 */

import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileType = searchParams.get("file") || "business-info";
    
    // .xlsx와 .xls 모두 지원
    const fileNameXlsx = fileType === "business-info" ? "사업장정보.xlsx" : "측정사업장.xlsx";
    const fileNameXls = fileType === "business-info" ? "사업장정보.xls" : "측정사업장.xls";
    const filePathXlsx = join(process.cwd(), fileNameXlsx);
    const filePathXls = join(process.cwd(), fileNameXls);
    
    // .xlsx를 우선 확인
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
      // 여러 방법 시도
      let workbook;
      let errorMessage = "";

      // 방법 1: readFile 사용
      try {
        workbook = XLSX.readFile(filePath, { 
          cellDates: true,
          cellNF: false,
          cellText: false,
        });
      } catch (err1) {
        errorMessage += `readFile 실패: ${err1 instanceof Error ? err1.message : String(err1)}\n`;
        
        // 방법 2: buffer로 읽기
        try {
          const buffer = readFileSync(filePath);
          workbook = XLSX.read(buffer, {
            type: "buffer",
            cellDates: true,
          });
        } catch (err2) {
          errorMessage += `buffer 읽기 실패: ${err2 instanceof Error ? err2.message : String(err2)}\n`;
          throw new Error(`Excel 파일 읽기 실패:\n${errorMessage}`);
        }
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      // 범위 확인
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
      for (let col = decodedRange.s.c; col <= Math.min(decodedRange.e.c, decodedRange.s.c + 10); col++) {
        const headerAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        const dataAddress = XLSX.utils.encode_cell({ r: 1, c: col });
        const header = headers[col];
        const dataCell = worksheet[dataAddress];
        const data = dataCell ? dataCell.v : null;
        if (header) {
          firstRowSample[header] = data;
        }
      }

      return NextResponse.json({
        success: true,
        file_name: fileName,
        sheet_name: sheetName,
        total_columns: headers.length,
        total_rows: decodedRange.e.r + 1,
        headers,
        first_row_sample: firstRowSample,
      });

    } catch (parseError) {
      return NextResponse.json(
        {
          error: "Excel 파일 파싱 실패",
          message: parseError instanceof Error ? parseError.message : String(parseError),
          file_name: fileName,
          suggestion: "Excel 파일이 오래된 형식(.xls)일 수 있습니다. .xlsx 형식으로 변환해주세요.",
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

