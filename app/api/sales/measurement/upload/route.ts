
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
        const user = await getUser();
        if (!user) {
            return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
        }

        // 관리자 권한 체크 (한글 '관리자' 확인)
        if (user.role !== '관리자') {
            return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
        }

        // sales:write 권한도 기본적으로 필요
        await checkPermission("sales:write");

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
            cellDates: false, // 날짜 자동 변환 끔 (숫자로 받음)
            cellNF: false,
            cellText: false,
        });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(worksheet, { defval: undefined }) as Record<string, any>[];

        if (!rawData || rawData.length === 0) {
            return NextResponse.json({ error: "엑셀 파일에 데이터가 없습니다." }, { status: 400 });
        }

        // 4. 헤더 매핑 확인
        const firstRow = rawData[0];
        const headerKeys = Object.keys(firstRow);

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

            try {
                // 1. 숫자인 경우 (Excel Serial Number) - cellDates: false 일 때 날짜는 숫자로 옴
                if (typeof val === "number") {
                    // 엑셀 기준일(1899-12-30)과 JS 기준일(1970-01-01) 차이: 25569일
                    // 타임존과 무관하게 절대적인 날짜 계산
                    const serial = Math.floor(val);
                    const utc_days = serial - 25569;
                    const date_info = new Date(utc_days * 86400 * 1000);
                    return date_info.toISOString().split("T")[0];
                }

                // 2. Date 객체인 경우 (혹시 모를 대비)
                if (val instanceof Date) {
                    const kstString = val.toLocaleDateString("ko-KR", {
                        timeZone: "Asia/Seoul",
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit'
                    });
                    const parts = kstString.match(/\d+/g);
                    if (parts && parts.length >= 3) {
                        return `${parts[0]}-${parts[1]}-${parts[2]}`;
                    }
                    const adjusted = new Date(val.getTime() + (9 * 60 * 60 * 1000));
                    return adjusted.toISOString().split("T")[0];
                }

                // 3. 문자열 파싱
                const str = String(val).trim();
                if (!str) return null;

                const parts = str.split(/[\.\-\/\s]+/).filter(p => p.length > 0);
                if (parts.length >= 3) {
                    const y = parts[0];
                    const year = y.length === 2 ? `20${y}` : y;

                    if (year.length === 4) {
                        const m = parts[1].padStart(2, "0");
                        const d = parts[2].padStart(2, "0");
                        if (parseInt(m) >= 1 && parseInt(m) <= 12 && parseInt(d) >= 1 && parseInt(d) <= 31) {
                            return `${year}-${m}-${d}`;
                        }
                    }
                }
                return null;
            } catch (e) {
                console.error("날짜 파싱 오류:", e, val);
                return null;
            }
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
            const rowIndex = i + 2;

            const code = String(row[codeKey!] || "").trim().toUpperCase();
            const year = parseInt(String(row[yearKey!] || "0"));
            const period = String(row[periodKey!] || "").trim();

            if (!code || !year || !period) {
                continue;
            }

            try {
                const updates: Record<string, any> = {};

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

                mapField("measurement_fee_business", ["측정비(사업장)", "사업장측정비"], "number");
                mapField("measurement_fee_national", ["측정비(국고)", "국고측정비", "공단측정비"], "number");
                mapField("deposit_date_business", ["입금일(사업장)", "사업장입금일"], "date");
                mapField("deposit_amount_business", ["입금액(사업장)", "사업장입금액"], "number");
                mapField("deposit_date_national", ["입금일(국고)", "국고입금일", "공단입금일"], "date");
                mapField("deposit_amount_national", ["입금액(국고)", "국고입금액", "공단입금액"], "number");
                mapField("electronic_invoice_date", ["전자계산서", "발행일", "계산서발행일"], "date");
                mapField("invoice_email", ["이메일", "계산서타켓", "계산서이메일"], "string");
                mapField("invoice_business_name", ["발행처 상호", "발행처상호"], "string");
                mapField("invoice_business_number", ["발행처 사업자", "발행처사업자"], "string");

                if (Object.keys(updates).length === 0) {
                    continue;
                }

                // 1. 해당 일지 존재 여부 확인 및 기존 금액 조회
                const { data: journal, error: findError } = await supabase
                    .from("measurement_journal")
                    .select("id, measurement_fee_business, measurement_fee_national, deposit_amount_business, deposit_amount_national")
                    .eq("code", code)
                    .eq("measurement_year", year)
                    .eq("measurement_period", period)
                    .maybeSingle();

                if (findError) throw new Error(`검색 오류: ${findError.message}`);

                // 2. 합계 금액 자동 계산 (부분 업데이트 시 필수)
                // updates에 없는 필드는 기존 값(journal)을 이용해 합계를 재계산해야 함
                const currentFeeBusiness = updates.measurement_fee_business ?? journal?.measurement_fee_business ?? 0;
                const currentFeeNational = updates.measurement_fee_national ?? journal?.measurement_fee_national ?? 0;
                updates.measurement_fee_total = currentFeeBusiness + currentFeeNational;

                const currentDepositBusiness = updates.deposit_amount_business ?? journal?.deposit_amount_business ?? 0;
                const currentDepositNational = updates.deposit_amount_national ?? journal?.deposit_amount_national ?? 0;
                updates.deposit_total = currentDepositBusiness + currentDepositNational;

                let journalId = journal?.id;

                // 2. 일지가 없으면 자동 생성 시도
                if (!journalId) {
                    // measurement_business에서 기본 정보 찾기
                    const { data: businessData, error: businessError } = await supabase
                        .from("measurement_business")
                        .select("*")
                        .eq("code", code)
                        .eq("year", year)
                        .eq("period", period)
                        .maybeSingle();

                    if (businessError) throw new Error(`사업장 조회 오류: ${businessError.message}`);
                    if (!businessData) {
                        failCount++;
                        errors.push(`[${rowIndex}행] 대상 사업장 정보를 찾을 수 없음 (Code=${code}, Year=${year}, Period=${period}). 일지 생성 불가.`);
                        continue;
                    }

                    // business_info에서 추가 정보 찾기 (선택)
                    const { data: infoData } = await supabase
                        .from("business_info")
                        .select("*")
                        .eq("code", code)
                        .maybeSingle();

                    // 새 일지 생성
                    const newJournalData = {
                        code,
                        measurement_year: year,
                        measurement_period: period,
                        business_name: businessData.business_name,
                        address: businessData.address,
                        office_jurisdiction: businessData.office_jurisdiction,
                        measurement_start_date: businessData.measurement_start_date,
                        measurement_end_date: businessData.measurement_end_date,
                        measurer: businessData.measurer,
                        total_employees: businessData.total_employees,

                        // business_info에서 보완
                        business_number: infoData?.business_number || businessData.business_number,
                        representative_name: infoData?.representative_name || businessData.representative_name,
                        phone: infoData?.phone,
                        fax: infoData?.fax,

                        manager_name: businessData.manager_name || infoData?.manager_name,
                        manager_position: businessData.manager_position,
                        manager_mobile: businessData.manager_mobile,
                        manager_email: businessData.manager_email,
                        invoice_email: businessData.invoice_email,
                        industrial_accident_number: businessData.industrial_accident_number,

                        // 기본값
                        designated_office: "천안", // 기본값 설정 (필요시 로직 추가)
                        completion_status: "미완료",
                        created_by: user.name,
                        updated_by: user.name,

                        // 엑셀에서 받은 업데이트 데이터 바로 적용
                        ...updates
                    };

                    const { data: newJournal, error: createError } = await supabase
                        .from("measurement_journal")
                        .insert(newJournalData)
                        .select("id")
                        .single();

                    if (createError) throw new Error(`일지 생성 실패: ${createError.message}`);

                    successCount++;
                    // 생성과 동시에 업데이트 되었으므로 continue
                    continue;
                }

                // 3. 기존 일지가 있으면 업데이트 실행
                const { error: updateError } = await supabase
                    .from("measurement_journal")
                    .update({
                        ...updates,
                        updated_at: new Date().toISOString(),
                        updated_by: user.name
                    })
                    .eq("id", journalId);

                if (updateError) throw new Error(`업데이트 실패: ${updateError.message}`);

                successCount++;

            } catch (err: any) {
                failCount++;
                errors.push(`[${rowIndex}행] ${err.message}`);
            }
        }

        return NextResponse.json({
            success: true,
            message: `${successCount}건 처리 완료 (신규 생성 포함), ${failCount}건 실패`,
            details: errors,
            successCount,
            failCount
        });

    } catch (error: any) {
        console.error("일괄 업로드 오류:", error);
        return NextResponse.json({ error: error.message || "서버 오류 발생" }, { status: 500 });
    }
}
