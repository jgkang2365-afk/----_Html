
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";
import * as XLSX from "xlsx";
import { syncBusinessData } from "@/lib/utils/sync-helper";

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

        // 헤더 매핑 헬퍼
        const getValue = (row: any, keys: string[]) => {
            for (const key of keys) {
                if (row[key] !== undefined && row[key] !== null) {
                    return String(row[key]).trim();
                }
            }
            return null;
        };

        console.log(`[Upload] Starting upload for ${rawData.length} rows...`);
        const BATCH_SIZE = 20;

        for (let i = 0; i < rawData.length; i += BATCH_SIZE) {
            const batch = rawData.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (row, batchIndex) => {
                const currentIndex = i + batchIndex;
                try {
                    const rowNumber = currentIndex + 2;

                    const code = getValue(row, ["code", "m.i_code", "사업장코드", "관리번호", "코드"]);
                    let yearInput = getValue(row, ["year", "년도", "측정년도"]);
                    const period = getValue(row, ["period", "주기", "측정주기", "분기"]);

                    if (!code) throw new Error(`[${rowNumber}행] 사업장 코드가 없습니다.`);
                    if (!yearInput) throw new Error(`[${rowNumber}행] 측정년도가 없습니다.`);
                    if (!period) throw new Error(`[${rowNumber}행] 측정주기가 없습니다.`);

                    const year = parseInt(yearInput, 10);
                    if (isNaN(year)) throw new Error(`[${rowNumber}행] 측정년도가 유효하지 않습니다: ${yearInput}`);

                    const baseData: any = {
                        code,
                        year,
                        period,
                        business_name: getValue(row, ["business_name", "사업장명", "업체명"]),
                        address: getValue(row, ["address", "주소", "소재지"]),
                        business_category: getValue(row, ["business_category", "업종", "업태"]),
                        manager_name: getValue(row, ["manager_name", "담당자", "계획담당자"]),
                        plan_manager: getValue(row, ["plan_manager", "계획담당자", "담당"]),
                        manager_mobile: getValue(row, ["manager_mobile", "연락처", "휴대폰"]),
                        phone: getValue(row, ["phone", "전화번호", "회사전화"]),
                        notes: getValue(row, ["notes", "비고", "특이사항"]),
                        is_registered: getValue(row, ["is_registered", "계획진행", "실시여부", "상태"]) || "미확정",
                        office_jurisdiction: getValue(row, ["office_jurisdiction", "관할청", "소재지관할청"]),
                        measurement_month: getValue(row, ["measurement_month", "측정예정월", "예정월"]),
                        measurement_date: getValue(row, ["measurement_date", "측정확정일", "확정일"]),
                    };

                    const syncedData = await syncBusinessData(supabase, code, year, period, {
                        national_support_status: null,
                        previous_measurement_date: null,
                        previous_measurement_period: null,
                        future_measurement_period: null,
                        address: baseData.address,
                        business_category: baseData.business_category,
                        business_name: baseData.business_name,
                        manager_name: baseData.manager_name,
                        manager_mobile: baseData.manager_mobile,
                        phone: baseData.phone,
                        office_jurisdiction: baseData.office_jurisdiction,
                    });

                    const finalData = {
                        ...baseData,
                        national_support_status: syncedData.national_support_status,
                        previous_measurement_date: syncedData.previous_measurement_date,
                        previous_measurement_period: syncedData.previous_measurement_period,
                        future_measurement_period: syncedData.future_measurement_period,

                        address: baseData.address || syncedData.address,
                        business_name: baseData.business_name || syncedData.business_name,
                        business_category: baseData.business_category || syncedData.business_category,
                        manager_name: baseData.manager_name || syncedData.manager_name,
                        manager_mobile: baseData.manager_mobile || syncedData.manager_mobile,
                        phone: baseData.phone || syncedData.phone,
                        office_jurisdiction: baseData.office_jurisdiction || syncedData.office_jurisdiction,

                        measurement_month: baseData.measurement_month,
                        measurement_date: baseData.measurement_date,

                        updated_at: new Date().toISOString()
                    };

                    const { error } = await supabase
                        .from("measurement_target_business")
                        .upsert(finalData, { onConflict: "code,year,period" });

                    if (error) throw error;

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

        return NextResponse.json({
            success: true,
            data: results,
            message: `${results.success}건 성공, ${results.failed}건 실패`
        });

    } catch (error) {
        console.error("Upload API Error:", error);
        return NextResponse.json(
            { error: "업로드 처리 중 서버 오류가 발생했습니다." },
            { status: 500 }
        );
    }
}
