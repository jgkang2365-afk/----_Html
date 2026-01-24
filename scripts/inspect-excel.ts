import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import * as XLSX from "xlsx";
import { readFileSync } from "fs";
import { join } from "path";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function inspectExcel() {
    console.log("엑셀 파일 헤더 및 데이터 검사 시작...");

    // 로컬 파일 읽기
    const fileName = "temp_plan.xlsx";
    const filePath = join(process.cwd(), fileName);

    try {
        const fileBuffer = readFileSync(filePath);
        const workbook = XLSX.read(fileBuffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        console.log(`Sheet Name: ${sheetName}`);

        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

        console.log("=== First 5 Rows ===");
        // Print first 5 rows
        for (let i = 0; i < 5 && i < data.length; i++) {
            console.log(`Row ${i + 1}:`, JSON.stringify(data[i], null, 0)); // No pretty print to save lines
        }

    } catch (error) {
        console.error("Error:", error);
    }
}

inspectExcel();
