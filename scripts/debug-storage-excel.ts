
import { createClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceHasRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Storage 접근을 위해 필요할 수 있음

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase environment variables");
    process.exit(1);
}

// Storage 접근은 권한이 필요할 수 있으므로 service role key가 있으면 사용, 없으면 anon key 시도
const supabase = createClient(supabaseUrl, serviceHasRoleKey || supabaseKey);

async function debugStorageExcel() {
    console.log("Checking latest file in Storage 'business-info' folder...");

    try {
        // 1. 파일 목록 조회
        const { data: files, error: listError } = await supabase.storage
            .from("excel-files")
            .list("business-info", {
                limit: 10,
                offset: 0,
                sortBy: { column: "created_at", order: "desc" },
            });

        if (listError) {
            console.error("Storage list error:", listError);
            return;
        }

        if (!files || files.length === 0) {
            console.log("No files found in 'business-info' folder.");
            return;
        }

        const latestFile = files[0];
        const filePath = `business-info/${latestFile.name}`;
        console.log(`Latest file: ${filePath} (${latestFile.created_at}, ${latestFile.metadata?.size} bytes)`);

        // 2. 파일 다운로드
        const { data: fileData, error: downloadError } = await supabase.storage
            .from("excel-files")
            .download(filePath);

        if (downloadError) {
            console.error("Download error:", downloadError);
            return;
        }

        if (!fileData) {
            console.error("No data downloaded");
            return;
        }

        // 3. 엑셀 파싱
        const arrayBuffer = await fileData.arrayBuffer();
        const workbook = XLSX.read(Buffer.from(arrayBuffer), { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // JSON 변환
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
        console.log(`Parsed ${jsonData.length} rows from sheet '${sheetName}'`);

        // 4. 데이터 검색 (H0437, H0438, H0439)
        const targets = ["H0437", "H0438", "H0439"];
        let foundCount = 0;

        targets.forEach(code => {
            // '코드' 컬럼이나 전체 값에서 검색
            const found = jsonData.filter((row: any) => {
                // 1. '코드' 컬럼 직접 확인
                if (row["코드"] && String(row["코드"]).trim() === code) return true;
                // 2. 전체 값 스캔 (컬럼명 불일치 대비)
                return Object.values(row).some(val => String(val).trim().includes(code));
            });

            if (found.length > 0) {
                console.log(`\n✅ Found '${code}': ${found.length} rows`);
                found.forEach((row: any, idx) => {
                    console.log(`  [Match ${idx + 1}]`, JSON.stringify(row));
                });
                foundCount++;
            } else {
                console.log(`\n❌ Not Found '${code}'`);
            }
        });

        if (foundCount === 0) {
            console.log("\n⚠️ No target codes found in the uploaded file.");
            console.log("Possible reasons:");
            console.log("- User uploaded an old file.");
            console.log("- User saved the file but Excel didn't flush changes.");
            console.log("- Data is in a different sheet or column unmapped.");

            // 헤더 출력
            if (jsonData.length > 0) {
                console.log("\nFirst row keys (Headers):", Object.keys(jsonData[0] as object));
            }
        } else {
            console.log(`\nFound ${foundCount} out of ${targets.length} target codes.`);
        }

    } catch (err) {
        console.error("Unexpected error:", err);
    }
}

debugStorageExcel();
