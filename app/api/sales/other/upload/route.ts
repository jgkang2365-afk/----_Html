/**
 * 기타매출 Excel 파일 업로드 API
 * POST /api/sales/other/upload
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import * as XLSX from "xlsx";

export async function POST(request: NextRequest) {
  try {
    // 권한 체크
    await checkPermission("sales:write");

    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { error: "로그인이 필요합니다." },
        { status: 401 }
      );
    }

    // FormData에서 파일 추출
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "파일이 업로드되지 않았습니다." },
        { status: 400 }
      );
    }

    // Excel 파일 읽기
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, {
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellText: false,
    });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // 헤더 포함하여 읽기 (디버깅용)
    const rawDataWithHeader = XLSX.utils.sheet_to_json(worksheet, { 
      defval: null,
      header: 1, // 배열로 읽기 (첫 번째 행 확인용)
    });
    
    console.log("Excel 파일 읽기 결과:", {
      sheetName,
      totalRows: rawDataWithHeader.length,
      firstRow: rawDataWithHeader[0],
      secondRow: rawDataWithHeader[1],
    });
    
    // 객체 형태로 다시 읽기 (헤더를 키로 사용)
    // raw: true로 설정하면 날짜가 숫자로 읽히므로, cellDates: true와 함께 사용하여 Date 객체로 변환
    const rawData = XLSX.utils.sheet_to_json(worksheet, { 
      defval: null,
      raw: true, // 원시 값으로 읽기 (날짜는 숫자로 읽힘)
    }) as Record<string, any>[];

    console.log("파싱된 데이터:", {
      totalRows: rawData.length,
      headers: rawData.length > 0 ? Object.keys(rawData[0]) : [],
      firstRowSample: rawData[0],
    });

    if (!Array.isArray(rawData) || rawData.length === 0) {
      return NextResponse.json(
        { error: "Excel 파일에 데이터가 없습니다." },
        { status: 400 }
      );
    }

    // 헤더 행 제거 및 유효한 데이터 행 필터링
    // 첫 번째 행의 키들을 헤더로 간주
    const headerKeys = rawData.length > 0 ? Object.keys(rawData[0]) : [];
    console.log("감지된 헤더 키들:", headerKeys);
    
    // 헤더 이름이 "품명*" 또는 "품명"일 수 있음
    const itemNameKey = headerKeys.find(key => 
      key === "품명*" || key === "품명" || key.toLowerCase() === "item_name"
    ) || "품명";
    
    const dataRows = rawData.filter((row: any) => {
      // 모든 가능한 헤더 이름 조합 확인
      const itemName = row[itemNameKey] || row["품명*"] || row["품명"] || row["item_name"] || "";
      const itemNameStr = String(itemName).trim();
      
      // 빈 문자열이 아니고, 헤더로 보이는 값이 아닌 경우만 데이터로 간주
      if (!itemNameStr || itemNameStr === "품명" || itemNameStr === "품명*" || itemNameStr.toLowerCase() === "item_name") {
        return false;
      }
      
      // 숫자 값이 있는 경우도 확인 (매출년도 등)
      const hasValidData = itemNameStr || 
        row["매출년도*"] || row["매출년도"] || 
        row["합계금액*"] || row["합계금액"];
      
      return !!hasValidData;
    });

    console.log("필터링된 데이터 행 수:", dataRows.length);
    if (dataRows.length > 0) {
      console.log("첫 번째 데이터 행 샘플:", dataRows[0]);
    }

    if (dataRows.length === 0) {
      return NextResponse.json(
        { 
          error: "유효한 데이터 행이 없습니다.",
          details: `파일에서 읽은 헤더: ${rawData.length > 0 ? Object.keys(rawData[0]).join(", ") : "없음"}. '품명' 또는 '품명*' 컬럼을 확인해주세요.`
        },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    let successCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // 날짜 파싱 헬퍼 함수
    const parseDate = (dateValue: any): string | null => {
      if (!dateValue && dateValue !== 0) return null;
      
      // Date 객체인 경우
      if (dateValue instanceof Date) {
        if (isNaN(dateValue.getTime())) return null;
        return dateValue.toISOString().split("T")[0];
      }
      
      // 문자열인 경우
      if (typeof dateValue === "string") {
        const dateStr = dateValue.trim();
        if (!dateStr || dateStr === "null" || dateStr === "undefined" || dateStr === "") return null;
        
        // YYYY-MM-DD 형식 검증
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          // 유효한 날짜인지 확인
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            return dateStr;
          }
        }
        
        // YYYY/MM/DD 형식도 처리
        if (/^\d{4}\/\d{2}\/\d{2}$/.test(dateStr)) {
          const date = new Date(dateStr);
          if (!isNaN(date.getTime())) {
            return date.toISOString().split("T")[0];
          }
        }
        
        // Excel 날짜 숫자 변환 시도 (1900-01-01 기준)
        if (!isNaN(Number(dateStr)) && Number(dateStr) > 0) {
          try {
            // Excel 날짜는 1900-01-01부터의 일수 (실제로는 1900-01-01이 1이지만, 1899-12-30을 0으로 취급)
            const excelEpoch = new Date(1899, 11, 30); // 1899-12-30
            const days = Math.floor(Number(dateStr));
            const date = new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
            if (!isNaN(date.getTime())) {
              return date.toISOString().split("T")[0];
            }
          } catch (e) {
            console.error("Excel 날짜 변환 실패:", e, dateStr);
          }
        }
      }
      
      // 숫자인 경우 (Excel 날짜 숫자)
      if (typeof dateValue === "number" && dateValue > 0) {
        try {
          const excelEpoch = new Date(1899, 11, 30); // 1899-12-30
          const days = Math.floor(dateValue);
          const date = new Date(excelEpoch.getTime() + days * 24 * 60 * 60 * 1000);
          if (!isNaN(date.getTime())) {
            return date.toISOString().split("T")[0];
          }
        } catch (e) {
          console.error("Excel 날짜 숫자 변환 실패:", e, dateValue);
        }
      }
      
      return null;
    };

    // 숫자 파싱 헬퍼 함수
    const parseNumber = (value: any): number | null => {
      if (value === null || value === undefined || value === "") return null;
      const num = typeof value === "string" ? parseFloat(value.replace(/,/g, "")) : Number(value);
      return isNaN(num) ? null : num;
    };

    // 각 행을 처리
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      try {
        // 필드명 매핑 (한국어 헤더 -> 데이터베이스 필드명)
        // 헤더 이름이 "품명*" 또는 "품명"일 수 있음
        const itemName = String(
          row[itemNameKey] || row["품명*"] || row["품명"] || row["item_name"] || ""
        ).trim();
        const revenueYear = parseInt(
          row["매출년도*"] || row["매출년도"] || row["revenue_year"] || "0",
          10
        );
        const revenuePeriod = String(
          row["매출주기*"] || row["매출주기"] || row["revenue_period"] || ""
        ).trim();
        const totalAmount = parseNumber(
          row["합계금액*"] || row["합계금액"] || row["total_amount"] || 0
        );
        
        // 날짜 필드 파싱 - 가능한 모든 헤더명 조합 시도
        const invoiceDateKey = headerKeys.find(key => 
          key.includes("계산서 발행일") || key.includes("발행일")
        );
        const depositDateKey = headerKeys.find(key => 
          key.includes("입금일") && !key.includes("입금액")
        );
        
        const invoiceDateValue = invoiceDateKey ? row[invoiceDateKey] : 
                                  row["계산서 발행일*"] || row["계산서 발행일"] || row["invoice_date"] || null;
        const depositDateValue = depositDateKey ? row[depositDateKey] : 
                                 row["입금일*"] || row["입금일"] || row["deposit_date"] || null;
        
        console.log(`행 ${i + 2} 날짜 필드 원본 값:`, {
          invoiceDateKey,
          depositDateKey,
          invoiceDateValue,
          depositDateValue,
          invoiceDateValueType: typeof invoiceDateValue,
          depositDateValueType: typeof depositDateValue,
          invoiceDateParsed: parseDate(invoiceDateValue),
          depositDateParsed: parseDate(depositDateValue),
        });
        
        console.log(`행 ${i + 2} 파싱 결과:`, {
          itemName,
          revenueYear,
          revenuePeriod,
          totalAmount,
          rawRow: row,
        });

        // 필수 필드 검증
        if (!itemName || !revenueYear || !revenuePeriod || totalAmount === null) {
          errors.push(`행 ${i + 2}: 필수 필드가 누락되었습니다 (품명, 매출년도, 매출주기, 합계금액)`);
          errorCount++;
          continue;
        }

        // 측정주기 검증
        if (revenuePeriod !== "상반기" && revenuePeriod !== "하반기") {
          errors.push(`행 ${i + 2}: 매출주기는 '상반기' 또는 '하반기'여야 합니다.`);
          errorCount++;
          continue;
        }

        // 중복 체크: 품명, 매출년도, 매출주기 조합이 동일한 데이터가 있는지 확인
        const { data: existingRevenue, error: existingError } = await supabase
          .from("other_revenue")
          .select("id")
          .eq("item_name", itemName)
          .eq("revenue_year", revenueYear)
          .eq("revenue_period", revenuePeriod)
          .maybeSingle();

        if (existingError && existingError.code !== "PGRST116") {
          errors.push(`행 ${i + 2}: 중복 확인 중 오류 - ${existingError.message}`);
          errorCount++;
          continue;
        }

        if (existingRevenue) {
          errors.push(`행 ${i + 2}: 이미 존재하는 기타매출입니다 (품명: ${itemName}, 매출년도: ${revenueYear}, 매출주기: ${revenuePeriod})`);
          errorCount++;
          continue;
        }

        // 공급가액과 부가세 파싱 (데이터 그대로 적용, 자동 계산하지 않음)
        const supplyAmount = parseNumber(
          row[headerKeys.find(key => key.includes("공급가액")) || "공급가액"] ||
          row["공급가액*"] || row["공급가액"] || row["supply_amount"]
        );
        const vatAmount = parseNumber(
          row[headerKeys.find(key => key.includes("부가세")) || "부가세"] ||
          row["부가세*"] || row["부가세"] || row["vat_amount"]
        );

        // 합계금액 검증 (공급가액 + 부가세가 제공된 경우에만 검증)
        if (supplyAmount !== null && vatAmount !== null) {
          const calculatedTotal = supplyAmount + vatAmount;
          if (Math.abs(calculatedTotal - totalAmount) > 1) {
            // 1원 오차 허용
            errors.push(`행 ${i + 2}: 합계금액이 공급가액 + 부가세와 일치하지 않습니다.`);
            errorCount++;
            continue;
          }
        }

        // 날짜 파싱
        const parsedInvoiceDate = parseDate(invoiceDateValue);
        const parsedDepositDate = parseDate(depositDateValue);
        
        // 기타매출 데이터 생성 (데이터 그대로 적용, 자동 계산하지 않음)
        const otherRevenueData: any = {
          item_name: itemName,
          revenue_year: revenueYear,
          revenue_period: revenuePeriod,
          supply_amount: supplyAmount, // null이어도 그대로 저장
          vat_amount: vatAmount, // null이어도 그대로 저장
          total_amount: totalAmount,
          invoice_date: parsedInvoiceDate,
          deposit_date: parsedDepositDate,
          deposit_amount: parseNumber(
            row[headerKeys.find(key => key.includes("입금액") && !key.includes("입금일")) || "입금액"] ||
            row["입금액*"] || row["입금액"] || row["deposit_amount"]
          ),
          notes: String(
            row[headerKeys.find(key => key.includes("비고")) || "비고"] ||
            row["비고*"] || row["비고"] || row["notes"] || ""
          ).trim() || null,
          created_by: user.name,
          updated_by: user.name,
        };

        console.log(`행 ${i + 2} 저장할 데이터:`, {
          ...otherRevenueData,
          invoice_date: parsedInvoiceDate,
          deposit_date: parsedDepositDate,
        });

        // 기타매출 생성
        const { error: insertError } = await supabase
          .from("other_revenue")
          .insert(otherRevenueData);

        if (insertError) {
          errors.push(`행 ${i + 2}: 기타매출 생성 오류 - ${insertError.message}`);
          errorCount++;
        } else {
          successCount++;
        }
      } catch (error) {
        errors.push(`행 ${i + 2}: 처리 오류 - ${error instanceof Error ? error.message : String(error)}`);
        errorCount++;
      }
    }

    return NextResponse.json({
      success: errorCount === 0,
      message: `${successCount}개 기타매출이 업로드되었습니다.`,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("기타매출 업로드 API 오류:", error);

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
        error: "기타매출 업로드 중 오류가 발생했습니다.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
