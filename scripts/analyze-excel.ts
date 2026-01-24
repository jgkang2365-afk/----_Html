
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import dotenv from "dotenv";
import path from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl!, supabaseKey!);

async function analyzeExcel() {
    console.log("=== 최신 업로드 엑셀 파일 분석 ===\n");

    // Storage에서 최신 파일 목록 조회
    const { data: files, error: listError } = await supabase.storage
        .from("excel-files")
        .list("measurement-business", {
            limit: 1,
            sortBy: { column: "created_at", order: "desc" },
        });

    if (listError || !files || files.length === 0) {
        console.error("파일 목록 조회 실패:", listError);
        return;
    }

    const latestFile = files[0];
    console.log(`최신 파일: ${latestFile.name}`);

    // 파일 다운로드
    const filePath = `measurement-business/${latestFile.name}`;
    const { data: fileData, error: downloadError } = await supabase.storage
        .from("excel-files")
        .download(filePath);

    if (downloadError || !fileData) {
        console.error("파일 다운로드 실패:", downloadError);
        return;
    }

    // 엑셀 파일 분석
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    console.log(`\n시트명: ${sheetName}`);
    console.log(`범위: ${worksheet["!ref"]}`);

    // 첫 5개 행의 데이터 출력
    console.log("\n=== 첫 5개 행 분석 (Raw Cell 값) ===");
    for (let row = 0; row < 5; row++) {
        const rowData: any = {};
        for (let col = 0; col < 15; col++) {
            const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
            const cell = worksheet[cellAddress];
            const colLetter = XLSX.utils.encode_col(col);
            rowData[colLetter] = cell ? cell.v : "(empty)";
        }
        console.log(`행 ${row + 1}:`, rowData);
    }

    // sheet_to_json으로 파싱된 데이터 확인
    console.log("\n=== sheet_to_json 파싱 결과 (range: 1부터) ===");
    const range = worksheet["!ref"];
    if (range) {
        const decodedRange = XLSX.utils.decode_range(range);
        const newRange = {
            s: { r: 1, c: decodedRange.s.c },
            e: { r: decodedRange.e.r, c: decodedRange.e.c }
        };
        const newRangeStr = XLSX.utils.encode_range(newRange);

        const data = XLSX.utils.sheet_to_json(worksheet, {
            defval: null,
            raw: false,
            range: newRangeStr
        });

        console.log(`파싱된 데이터 총 건수: ${data.length}`);
        console.log(`첫 번째 데이터 행의 모든 키:`, Object.keys(data[0] || {}));

        // 첫 3개 행 상세 출력
        console.log("\n첫 3개 행 상세:");
        for (let i = 0; i < Math.min(3, data.length); i++) {
            const row = data[i] as any;
            console.log(`\n--- 행 ${i + 1} ---`);
            console.log(`  "년도" 값: ${row["년도"]}`);
            console.log(`  "구분" 값: ${row["구분"]}`);
            console.log(`  "코드" 값: ${row["코드"]}`);
            console.log(`  "사업장명" 값: ${row["사업장명"]}`);
        }

        // 년도별 분포 확인
        const yearDist: any = {};
        (data as any[]).forEach(row => {
            const year = row["년도"] || row["측정년도"] || "unknown";
            yearDist[year] = (yearDist[year] || 0) + 1;
        });
        console.log("\n=== 엑셀 파일 내 년도 분포 ===");
        console.table(yearDist);
    }
}

analyzeExcel();
