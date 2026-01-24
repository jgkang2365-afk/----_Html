import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { syncMeasurementBusiness } from "../lib/sync/excel-sync";

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function reparseExcel() {
    console.log("엑셀 파일 재파싱 시작 (저장소의 최신 파일 사용)...");

    // null을 전달하면 저장소(Storage)에서 최신 파일을 가져와서 처리함
    const result = await syncMeasurementBusiness(undefined);

    console.log("재파싱 결과:", result);
}

reparseExcel();
