
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import { getUser } from "@/lib/auth/get-user";
import * as XLSX from "xlsx";

/**
 * 측정비/입금정보 부분 업데이트를 위한 Excel 업로드 API
 * POST /api/sales/measurement/upload
 * 
 * 기능:
 * - 엑셀 파일을 업로드받아 measurement_journal 테이블을 업데이트합니다.
 * - 부분 업데이트 지원: 엑셀 파일에 값이 있는 셀만 DB에 반영하고, 비어있는 셀은 기존 DB 값을 유지합니다.
 * - 식별자(필수): 코드(code), 측정년도(measurement_year), 측정주기(measurement_period)
 */
export async function POST(request: NextRequest) {
    try {
        // 1. 권한 및 사용자 체크
        await checkPermission("sales:write");
        const user = await getUser();
        if (!user) {
            return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
        }

        // 2. 파일 수신
        const formData = await request.formData();
        const file = formData.get("file") as File;
        if (!file) {
            return NextResponse.json({ error: "파일이 업로드되지 않았습니다." }, { status: 400 });
        }

        // 3. Excel 파싱
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, {
            type: "buffer",
            cellDates: true, // 날짜 자동 인식
            cellNF: false,
            cellText: false,
        });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        // 헤더를 포함한 JSON 변환 (raw: false로 하면 포맷팅된 문자열로 읽힘, 여기선 날짜 처리를 위해 일부러 raw값 확인 로직 필요할 수도 있으나 cellDates: true로 Date객체 유도)
        const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: undefined }) as Record<string, any>[];

        if (!rawData || rawData.length === 0) {
            return NextResponse.json({ error: "엑셀 파일에 데이터가 없습니다." }, { status: 400 });
        }

        // 4. 헤더 매핑 확인
        const firstRow = rawData[0];
        const headerKeys = Object.keys(firstRow);

        // 필수 식별자 컬럼 확인 함수
        const findKey = (candidates: string[]) => headerKeys.find(key => candidates.some(c => key.includes(c) || key.toLowerCase() === c));

        const codeKey = findKey(["코드", "code"]);
        const yearKey = findKey(["측정년도", "year", "매출년도"]);
        const periodKey = findKey(["측정주기", "period", "매출주기"]);

        if (!codeKey || !yearKey || !periodKey) {
            return NextResponse.json({
                error: "필수 컬럼(코드, 측정년도, 측정주기)을 찾을 수 없습니다.",
                details: `감지된 헤더: ${headerKeys.join(", ")}`
            }, { status: 400 });
        }

        const supabase = await createClient();
        let successCount = 0;
        let failCount = 0;
        const errors: string[] = [];

        // 헬퍼: 날짜 파싱 (YYYY-MM-DD)
        const parseDate = (val: any): string | null => {
            if (!val) return null;
            if (val instanceof Date) return val.toISOString().split("T")[0];
            const str = String(val).trim();
            // YYYY-MM-DD
            if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
            // YYYY/MM/DD
            if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, "-");
            // 그 외 엑셀 숫자형 날짜 등 처리 필요 시 추가
            return null;
        };

        // 헬퍼: 숫자 파싱
        const parseNumber = (val: any): number | null => {
            if (val === undefined || val === null || String(val).trim() === "") return null;
            const num = parseFloat(String(val).replace(/,/g, ""));
            return isNaN(num) ? null : num;
        };

        // 5. 데이터 처리 루프
        for (let i = 0; i < rawData.length; i++) {
            const row = rawData[i];
            const rowIndex = i + 2; // 엑셀 행 번호 (헤더1 + 인덱스0 시작 = 2)

            const code = String(row[codeKey!] || "").trim();
            const year = parseInt(String(row[yearKey!] || "0"));
            const period = String(row[periodKey!] || "").trim();

            if (!code || !year || !period) {
                // 식별자 누락 시 스킵
                continue;
            }

            try {
                // 업데이트할 데이터를 담을 객체
                const updates: Record<string, any> = {};

                // === 매핑 로직 ===
                // 엑셀 컬럼명(한글) -> DB 컬럼명
                // 값이 "존재하는 경우"에만 updates 객체에 추가 (Partial Update)

                const mapField = (dbField: string, keywords: string[], type: "string" | "number" | "date") => {
                    const key = findKey(keywords);
                    if (key && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
                        const val = row[key];
                        if (type === "number") {
                            const num = parseNumber(val);
                            if (num !== null) updates[dbField] = num;
                        } else if (type === "date") {
                            const date = parseDate(val);
                            if (date !== null) updates[dbField] = date;
                        } else {
                            updates[dbField] = String(val).trim();
                        }
                    }
                };

                // --- 필드 매핑 정의 ---
                // 측정비
                mapField("measurement_fee_business", ["측정비(사업장)", "사업장측정비"], "number");
                mapField("measurement_fee_national", ["측정비(국고)", "국고측정비", "공단측정비"], "number");

                // 입금 정보 (사업장)
                mapField("deposit_date_business", ["입금일(사업장)", "사업장입금일"], "date");
                mapField("deposit_amount_business", ["입금액(사업장)", "사업장입금액"], "number");

                // 입금 정보 (국고)
                mapField("deposit_date_national", ["입금일(국고)", "국고입금일", "공단입금일"], "date");
                mapField("deposit_amount_national", ["입금액(국고)", "국고입금액", "공단입금액"], "number");

                // 계산서 정보
                mapField("electronic_invoice_date", ["전자계산서", "발행일", "계산서발행일"], "date");
                mapField("invoice_email", ["이메일", "계산서타켓", "계산서이메일"], "string");

                // 업데이트할 내용이 없으면 스킵
                if (Object.keys(updates).length === 0) {
                    continue;
                }

                // --- DB 업데이트 ---
                // 1. 해당 일지 찾기
                const { data: journal, error: findError } = await supabase
                    .from("measurement_journal")
                    .select("id")
                    .eq("code", code)
                    .eq("measurement_year", year)
                    .eq("measurement_period", period)
                    .maybeSingle();

                if (findError) throw new Error(`검색 오류: ${findError.message}`);
                if (!journal) {
                    failCount++;
                    errors.push(`[${rowIndex}행] 일지를 찾을 수 없음 (Code: ${code})`);
                    continue;
                }

                // 2. 합계 금액 자동 계산 (옵션)
                // 만약 사업장/국고 측정비가 업데이트되었다면, measurement_fee_total도 업데이트해주면 좋음.
                // 하지만 기존 값을 읽어와야 하므로 쿼리가 복잡해짐.
                // 사용자가 명시하지 않은 필드는 건드리지 않는다는 원칙에 따라, 
                // 입력된 값만 업데이트함. (Trigger나 DB 함수가 없다면 합계 불일치 가능성 있으나, "부분 업로드" 취지에 맞게 명시적 입력만 처리)

                // 업데이트 실행
                const { error: updateError } = await supabase
                    .from("measurement_journal")
                    .update({
                        ...updates,
                        updated_at: new Date().toISOString(),
                        updated_by: user.name
                    })
                    .eq("id", journal.id);

                if (updateError) throw new Error(`업데이트 실패: ${updateError.message}`);

                successCount++;

            } catch (err: any) {
                failCount++;
                errors.push(`[${rowIndex}행] ${err.message}`);
            }
        }

        return NextResponse.json({
            success: true,
            message: `${successCount}건 업데이트 완료, ${failCount}건 실패`,
            details: errors,
            successCount,
            failCount
        });

    } catch (error: any) {
        console.error("일괄 업로드 오류:", error);
        return NextResponse.json({ error: error.message || "서버 오류 발생" }, { status: 500 });
    }
}
