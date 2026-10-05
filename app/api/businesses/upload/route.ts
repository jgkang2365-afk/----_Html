
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import * as XLSX from "xlsx";
import { syncBusinessData, normalizeBusinessStatus } from "@/lib/utils/sync-helper";
import { ensureBusinessCoordinate } from "@/lib/business-coordinates/service";
import { importRow } from "@/lib/excel-contract/contract";
import { measurementTargetFields } from "@/lib/excel-contract/measurement-target";

// 최대 처리 행 수 (타임아웃 방지)
const MAX_ROWS = 500;

export async function POST(request: NextRequest) {
    try {
        await checkPermission("journal:write");

        const formData = await request.formData();
        const file = formData.get("file") as File;

        if (!file) {
            return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
        }

        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        // raw: false 옵션을 사용하여 엑셀에 보이는 텍스트 그대로 읽기 (날짜 포맷 유지 등)
        const rawData = XLSX.utils.sheet_to_json(sheet, { raw: false }) as any[];

        if (rawData.length === 0) {
            return NextResponse.json({ error: "엑셀 파일에 데이터가 없습니다." }, { status: 400 });
        }

        if (rawData.length > MAX_ROWS) {
            return NextResponse.json(
                { error: `한 번에 최대 ${MAX_ROWS}행까지만 업로드할 수 있습니다.` },
                { status: 400 }
            );
        }

        const supabase = await createClient();
        const results = {
            success: 0,
            failed: 0,
            errors: [] as string[]
        };

        const parseRow = (row: any) => importRow(measurementTargetFields, row);

        const calculateFutureMeasurementDate = (previousDate: string | null, futurePeriodMonths: number | null) => {
            if (!previousDate || !futurePeriodMonths) return null;
            const match = previousDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
            if (!match) return null;

            const year = parseInt(match[1], 10);
            const month = parseInt(match[2], 10);
            const day = parseInt(match[3], 10);
            const targetMonthIndex = month - 1 + futurePeriodMonths;
            const targetYear = year + Math.floor(targetMonthIndex / 12);
            const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
            const lastDayOfTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
            const targetDay = Math.min(day, lastDayOfTargetMonth);
            const calculated = new Date(targetYear, targetMonth, targetDay);

            const yyyy = calculated.getFullYear();
            const mm = String(calculated.getMonth() + 1).padStart(2, "0");
            const dd = String(calculated.getDate()).padStart(2, "0");
            return `${yyyy}-${mm}-${dd}`;
        };

        // 1. 업로드 대상 사업장 코드, 년도, 주기 수집하여 건강디딤돌 결과 Bulk 조회 (상호 동기화 안전장치)
        const uploadCodes = rawData.map(row => parseRow(row).code).filter(Boolean) as string[];
        const uniqueCodes = Array.from(new Set(uploadCodes));
        const nationalSupportMap = new Map<string, string>(); // 'code-year-period' -> '대상' | '비대상'

        if (uniqueCodes.length > 0) {
            const { data: supportApplications, error: supportError } = await supabase
                .from("national_support_application")
                .select("code, year, period, national_support_status")
                .in("code", uniqueCodes);

            if (!supportError && supportApplications) {
                supportApplications.forEach((app: any) => {
                    const key = `${app.code}-${app.year}-${app.period}`;
                    if (app.national_support_status) {
                        nationalSupportMap.set(key, app.national_support_status);
                    }
                });
            }
        }

        console.log(`[Upload] Starting upload for ${rawData.length} rows...`);
        const BATCH_SIZE = 3;

        for (let i = 0; i < rawData.length; i += BATCH_SIZE) {
            const batch = rawData.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (row, batchIndex) => {
                const currentIndex = i + batchIndex;
                try {
                    const rowNumber = currentIndex + 2;

                    const fields = parseRow(row);
                    const code = String(fields.code || "");
                    const yearInput = fields.year;
                    const period = String(fields.period || "");

                    if (!code) throw new Error(`[${rowNumber}행] 사업장 코드가 없습니다.`);
                    if (!yearInput) throw new Error(`[${rowNumber}행] 측정년도가 없습니다.`);
                    if (!period) throw new Error(`[${rowNumber}행] 측정주기가 없습니다.`);

                    const year = parseInt(String(yearInput), 10);
                    if (isNaN(year)) throw new Error(`[${rowNumber}행] 측정년도가 유효하지 않습니다: ${yearInput}`);

                    const key = `${code}-${year}-${period}`;
                    let existingSupportStatus = nationalSupportMap.get(key) || null;
                    if (existingSupportStatus === "지원" || existingSupportStatus === "지원대상" || existingSupportStatus === "대상") {
                        existingSupportStatus = "대상";
                    }

                    const baseData: any = {
                        code,
                        year,
                        period,
                        business_name: fields.business_name || null,
                        address: fields.address || null,
                        business_category: fields.business_category || null,
                        manager_name: fields.manager_name || fields.plan_manager || null,
                        plan_manager: fields.plan_manager || null,
                        manager_mobile: fields.manager_mobile || null,
                        phone: fields.phone || null,
                        fax: fields.fax || null,
                        business_number: fields.business_number || null,
                        industrial_accident_number: fields.industrial_accident_number || null,
                        commencement_number: fields.commencement_number || null,
                        representative_name: fields.representative_name || null,
                        notes: fields.notes || null,
                        is_registered_text: normalizeBusinessStatus(String(fields.is_registered || "")),
                        office_jurisdiction: fields.office_jurisdiction || null,
                        previous_measurement_date: fields.previous_measurement_date || null,
                        previous_measurement_period: fields.previous_measurement_period || null,
                        future_measurement_period: fields.future_measurement_period || null,
                    };

                    const syncedData = await syncBusinessData(supabase, code, year, period, {
                        address: baseData.address,
                        business_category: baseData.business_category,
                        business_name: baseData.business_name,
                        manager_name: baseData.manager_name,
                        manager_mobile: baseData.manager_mobile,
                        phone: baseData.phone,
                        fax: baseData.fax,
                        business_number: baseData.business_number,
                        industrial_accident_number: baseData.industrial_accident_number,
                        commencement_number: baseData.commencement_number,
                        representative_name: baseData.representative_name,
                        office_jurisdiction: baseData.office_jurisdiction,
                        status: baseData.is_registered_text,
                        previous_measurement_date: baseData.previous_measurement_date,
                        previous_measurement_period: baseData.previous_measurement_period,
                        future_measurement_period: baseData.future_measurement_period,
                    });

                    const previousMeasurementDate = baseData.previous_measurement_date || syncedData.previous_measurement_date;
                    const previousMeasurementPeriod = baseData.previous_measurement_period || syncedData.previous_measurement_period;
                    const futureMeasurementPeriod = baseData.future_measurement_period || syncedData.future_measurement_period;
                    const calculatedFutureDate = calculateFutureMeasurementDate(previousMeasurementDate, futureMeasurementPeriod);

                    const finalData = {
                        ...baseData,
                        // 동기화된 정보 (null이 아닌 경우에만 덮어씀. 기존 건강디딤돌 업로드 결과가 있다면 최우선 적용)
                        national_support_status: existingSupportStatus || syncedData.national_support_status,
                        previous_measurement_date: previousMeasurementDate,
                        previous_measurement_period: previousMeasurementPeriod,
                        future_measurement_period: futureMeasurementPeriod,

                        // [Latest Wins] 엑셀 값이 있으면 우선, 없으면 동기화(DB) 데이터 사용
                        address: baseData.address || syncedData.address,
                        business_name: baseData.business_name || syncedData.business_name,
                        business_category: baseData.business_category || syncedData.business_category,
                        manager_name: baseData.manager_name || syncedData.manager_name,
                        manager_mobile: baseData.manager_mobile || syncedData.manager_mobile,
                        phone: baseData.phone || syncedData.phone,
                        fax: baseData.fax || syncedData.fax,
                        business_number: baseData.business_number || syncedData.business_number,
                        industrial_accident_number: baseData.industrial_accident_number || syncedData.industrial_accident_number,
                        commencement_number: baseData.commencement_number || syncedData.commencement_number,
                        representative_name: baseData.representative_name || syncedData.representative_name,
                        office_jurisdiction: baseData.office_jurisdiction || syncedData.office_jurisdiction,

                        // 상태값 표준화 적용
                        is_registered_text: normalizeBusinessStatus(baseData.is_registered_text || syncedData.status),

                        measurement_month: calculatedFutureDate ? String(parseInt(calculatedFutureDate.slice(5, 7), 10)) : null,
                        future_measurement_date: calculatedFutureDate,

                        updated_at: new Date().toISOString()
                    };

                    const upsertData = {
                        ...finalData,
                        is_registered: finalData.is_registered_text,
                    };
                    delete (upsertData as any).business_number;
                    delete (upsertData as any).is_registered_text;

                    const { error } = await supabase
                        .from("measurement_target_business")
                        .upsert(upsertData, { onConflict: "code,year,period" });

                    if (error) throw error;

                    try {
                        await ensureBusinessCoordinate(supabase, {
                            code,
                            businessName: finalData.business_name,
                            fallbackAddress: finalData.address,
                        });
                    } catch (coordinateError) {
                        // 좌표 실패는 업로드 성공 건수를 실패로 바꾸지 않는다.
                        console.error(`[BusinessCoordinates] 업로드 좌표 처리 실패 (${code}):`, coordinateError instanceof Error ? coordinateError.message : "unknown");
                    }

                    results.success++;
                } catch (error) {
                    // console.error(`Row ${currentIndex + 2} error:`, error);
                    results.failed++;
                    results.errors.push(error instanceof Error ? error.message : String(error));
                }
            });

            await Promise.all(batchPromises);
            console.log(`[Upload] Processed ${Math.min(i + BATCH_SIZE, rawData.length)} / ${rawData.length} rows`);
        }

        const allSucceeded = results.failed === 0;
        const firstError = results.errors[0];

        return NextResponse.json({
            success: allSucceeded,
            data: results,
            message: `${results.success}건 성공, ${results.failed}건 실패`,
            error: allSucceeded ? undefined : `${results.failed}건 저장 실패${firstError ? `: ${firstError}` : ""}`,
        });

    } catch (error) {
        console.error("Upload API Error:", error);
        return NextResponse.json(
            { error: "업로드 처리 중 서버 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
