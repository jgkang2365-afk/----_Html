/**
 * Storage에 업로드된 Excel 파일의 컬럼 구조 확인 API
 * GET /api/test-excel-columns-storage?file=measurement-business
 * Storage에 업로드된 Excel 파일의 실제 컬럼명을 확인하여 매핑 문제를 진단합니다.
 */

import { NextResponse } from "next/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { createAdminClient } from "@/lib/supabase/admin";
import * as XLSX from "xlsx";

export async function GET(request: Request) {
  try {
    // 권한 체크
    await checkPermission(["system:settings", "dashboard:read"]);

    const { searchParams } = new URL(request.url);
    const fileType = searchParams.get("file") || "measurement-business";
    
    if (fileType !== "measurement-business" && fileType !== "business-info") {
      return NextResponse.json(
        { error: "file 파라미터는 'measurement-business' 또는 'business-info'여야 합니다." },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    // Storage에서 최신 파일 가져오기
    const { data: files, error: listError } = await supabase.storage
      .from("excel-files")
      .list(fileType, {
        limit: 1,
        offset: 0,
        sortBy: { column: "created_at", order: "desc" },
      });

    if (listError || !files || files.length === 0) {
      return NextResponse.json(
        { error: `Storage에 ${fileType} 파일이 없습니다.` },
        { status: 404 }
      );
    }

    const latestFile = files[0];
    const filePath = `${fileType}/${latestFile.name}`;

    // 파일 다운로드
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("excel-files")
      .download(filePath);

    if (downloadError || !fileData) {
      return NextResponse.json(
        { error: `파일 다운로드 실패: ${downloadError?.message || "알 수 없는 오류"}` },
        { status: 500 }
      );
    }

    // Blob을 Buffer로 변환
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    try {
      // xlsx 라이브러리로 읽기 시도 (여러 옵션 시도)
      let workbook;
      let parseError = null;
      
      // 방법 1: 기본 옵션
      try {
        workbook = XLSX.read(buffer, {
          type: "buffer",
          cellDates: true,
          cellNF: false,
          cellText: false,
        });
      } catch (err1) {
        parseError = err1;
        
        // 방법 2: cellText를 true로 시도
        try {
          workbook = XLSX.read(buffer, {
            type: "buffer",
            cellDates: false,
            cellNF: false,
            cellText: true,
          });
          parseError = null;
        } catch (err2) {
          parseError = err2;
        }
      }
      
      if (!workbook || parseError) {
        return NextResponse.json(
          {
            error: "Excel 파일 파싱 실패",
            message: parseError instanceof Error ? parseError.message : String(parseError),
            file_name: latestFile.name,
            suggestion: "파일이 오래된 Excel 형식(.xls)일 수 있습니다. Excel에서 파일을 열어 '.xlsx' 형식으로 저장한 후 다시 업로드해주세요.",
          },
          { status: 500 }
        );
      }

      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      
      const range = worksheet["!ref"];
      if (!range) {
        return NextResponse.json({
          error: "데이터가 없습니다",
          file_name: latestFile.name,
        });
      }

      const decodedRange = XLSX.utils.decode_range(range);
      
      // 첫 번째 행이 비어있는지 확인 (측정사업장 파일의 경우)
      // 파일명에 "측정사업장"이 포함되어 있으면 확인
      const firstRowCell = XLSX.utils.encode_cell({ r: 0, c: 0 });
      const firstRowHasData = worksheet[firstRowCell] && String(worksheet[firstRowCell].v || "").trim();
      
      let headerRowIndex = 0;
      if (!firstRowHasData && fileType === "measurement-business") {
        // 첫 번째 행이 비어있으면 두 번째 행을 헤더로 사용
        headerRowIndex = 1;
      }
      
      // 헤더 읽기
      const headers: string[] = [];
      for (let col = decodedRange.s.c; col <= decodedRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
        const cell = worksheet[cellAddress];
        const header = cell ? String(cell.v || "").trim() : "";
        headers.push(header);
      }

      // 첫 번째 데이터 행 샘플 (헤더 다음 행)
      const firstDataRowIndex = headerRowIndex + 1;
      const firstRowSample: Record<string, any> = {};
      for (let col = decodedRange.s.c; col <= decodedRange.e.c; col++) {
        const headerAddress = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
        const dataAddress = XLSX.utils.encode_cell({ r: firstDataRowIndex, c: col });
        const header = headers[col - decodedRange.s.c];
        const dataCell = worksheet[dataAddress];
        const data = dataCell ? dataCell.v : null;
        if (header) {
          firstRowSample[header] = data;
        }
      }

      // 측정사업장의 경우 주요 컬럼 확인
      let keyColumnsCheck: Record<string, boolean> = {};
      if (fileType === "measurement-business") {
        keyColumnsCheck = {
          "코드": headers.some(h => h === "코드"),
          "년도": headers.some(h => h === "년도"),
          "구분": headers.some(h => h === "구분"),
          "사업장명": headers.some(h => h === "사업장명"),
        };
      }

      return NextResponse.json({
        success: true,
        file_name: latestFile.name,
        file_type: fileType,
        sheet_name: sheetName,
        total_columns: headers.length,
        header_row_index: headerRowIndex,
        all_headers: headers,
        first_row_sample: firstRowSample,
        key_columns_check: keyColumnsCheck,
      });
    } catch (parseError) {
      return NextResponse.json(
        {
          error: "Excel 파일 파싱 실패",
          message: parseError instanceof Error ? parseError.message : String(parseError),
          file_name: latestFile.name,
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Storage Excel 컬럼 확인 API 오류:", error);
    
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
        error: "오류 발생",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
