
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function excelDateToJSDate(excelDate: number): string {
    const excelEpoch = new Date(1899, 11, 30);
    const jsDate = new Date(excelEpoch.getTime() + excelDate * 24 * 60 * 60 * 1000);
    const year = jsDate.getFullYear();
    const month = String(jsDate.getMonth() + 1).padStart(2, "0");
    const day = String(jsDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseBusinessInfo(data: any[]): any[] {
    return data.map((row: any) => {
        const baseData: any = {
            code: String(row["코드"] || "").trim(),
            business_name: String(row["사업장명"] || "").trim(),
            business_number: row["사업자번호"] || null,
            address1: row["주소1"] || null,
            address2: row["주소2"] || null,
            phone: row["전화번호"] || null,
            fax: row["팩스번호"] || null,
            representative_name: row["대표자명"] || null,
        };

        const optionalFields: any = {};
        if (row["우편번호"]) optionalFields.postal_code = String(row["우편번호"]).trim();
        if (row["업태"]) optionalFields.business_type = String(row["업태"]).trim();
        if (row["업종코드"]) optionalFields.business_category_code = String(row["업종코드"]).trim();
        if (row["업종"]) optionalFields.business_category = String(row["업종"]).trim();

        const officeJurisdictionValue = row["관할청"];
        if (officeJurisdictionValue !== undefined && officeJurisdictionValue !== null && officeJurisdictionValue !== "") {
            const trimmedValue = String(officeJurisdictionValue).trim();
            if (trimmedValue) {
                optionalFields.office_jurisdiction = trimmedValue;
            }
        }

        const officeCodeValue = row["관할청코드"] || null;
        if (officeCodeValue != null) {
            const trimmedValue = String(officeCodeValue).trim();
            if (trimmedValue) {
                optionalFields.office_code = trimmedValue;
            }
        }

        if (row["주생산품"]) optionalFields.main_product = String(row["주생산품"]).trim();
        if (row["남근로수"]) optionalFields.male_employees = parseInt(String(row["남근로수"]), 10) || null;
        if (row["여근로수"]) optionalFields.female_employees = parseInt(String(row["여근로수"]), 10) || null;
        if (row["관리번호"]) optionalFields.management_number = String(row["관리번호"]).trim();
        if (row["계산서 메일"]) optionalFields.invoice_email = String(row["계산서 메일"]).trim();
        if (row["계산서 담당"]) optionalFields.invoice_manager = String(row["계산서 담당"]).trim();
        if (row["직위"]) optionalFields.manager_position = String(row["직위"]).trim();
        if (row["연락처"]) optionalFields.manager_contact = String(row["연락처"]).trim();
        if (row["년도"]) optionalFields.year = parseInt(String(row["년도"]), 10) || null;

        if (row["등록일"]) {
            const regDate = row["등록일"];
            if (typeof regDate === "number") {
                optionalFields.registration_date = excelDateToJSDate(regDate);
            } else {
                const dateStr = String(regDate).trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                    optionalFields.registration_date = dateStr;
                }
            }
        }

        if (row["향후측정예상일"]) {
            const futureDate = row["향후측정예상일"];
            if (typeof futureDate === "number") {
                optionalFields.future_measurement_date = excelDateToJSDate(futureDate);
            } else {
                const dateStr = String(futureDate).trim();
                if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                    optionalFields.future_measurement_date = dateStr;
                }
            }
        }

        if (row["비고"]) optionalFields.notes = String(row["비고"]).trim();

        return { ...baseData, ...optionalFields };
    }).filter((row) => row.code && row.business_name);
}

async function debugSyncLogic() {
    console.log("Starting Debug Sync Logic...");
    const filePath = "business-info/business-info-2026-01-30T04-39-06.xlsx";

    // 1. Download
    const { data: fileData, error: downloadError } = await supabase.storage
        .from("excel-files")
        .download(filePath);

    if (downloadError) {
        console.error("Download Error:", downloadError);
        return;
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const workbook = XLSX.read(Buffer.from(arrayBuffer), { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const excelData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

    console.log(`Excel Data Length: ${excelData.length}`);

    // 2. Parse pass
    const parsedData = parseBusinessInfo(excelData as any[]);
    console.log(`Parsed Data Length: ${parsedData.length}`);

    // 3. Check H0437 in parsed data
    const h0437 = parsedData.find(r => r.code === 'H0437');
    console.log(`H0437 in Parsed Data:`, h0437 ? 'Yes' : 'No');
    if (h0437) {
        console.log('H0437:', JSON.stringify(h0437));
    }

    // 4. Check DB for H0437
    const { data: dbCheck, error: dbError } = await supabase
        .from('business_info')
        .select('code')
        .eq('code', 'H0437');

    console.log(`DB Check for H0437:`, dbCheck?.length ? 'Found' : 'Not Found');

    // 5. Simulate existingCodesSet logic
    const codes = parsedData.map(row => row.code).filter(Boolean);
    const existingCodesSet = new Set<string>();

    if (codes.length > 0) {
        const batchSize = 1000;
        for (let i = 0; i < codes.length; i += batchSize) {
            const codeBatch = codes.slice(i, i + batchSize);
            const { data: existingCodes, error: selectError } = await supabase
                .from("business_info")
                .select("code")
                .in("code", codeBatch);

            if (existingCodes) {
                existingCodes.forEach(item => {
                    if (item.code) existingCodesSet.add(item.code);
                });
            }
        }
    }

    console.log(`Existing Codes Count: ${existingCodesSet.size}`);
    console.log(`Is H0437 in Existing Set?`, existingCodesSet.has('H0437') ? 'Yes' : 'No');

    // 6. Split
    const toInsert: any[] = [];
    const toUpdate: any[] = [];

    parsedData.forEach(row => {
        if (existingCodesSet.has(row.code)) {
            toUpdate.push(row);
        } else {
            toInsert.push(row);
        }
    });

    console.log(`To Insert: ${toInsert.length}`);
    console.log(`To Update: ${toUpdate.length}`);

    if (toInsert.length > 0) {
        console.log('Sample Insert Codes:', toInsert.slice(0, 5).map(r => r.code));
    }
}

debugSyncLogic();
