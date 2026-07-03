import { createClient } from "../lib/supabase/server";
import * as dotenv from "dotenv";
import * as path from "path";

// .env.local 로드
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

async function checkTable() {
    try {
        console.log("Supabase 클라이언트 생성 중...");
        const supabase = await createClient();
        
        console.log("background_jobs 테이블 조회 시도...");
        const { data, error } = await supabase
            .from("background_jobs")
            .select("id")
            .limit(1);

        if (error) {
            if (error.message.includes("does not exist")) {
                console.error("❌ 테이블 없음: 'background_jobs' 테이블이 아직 생성되지 않았습니다.");
                process.exit(1);
            } else {
                console.error("❌ 조회 오류 발생:", error.message);
                process.exit(1);
            }
        }

        console.log("✅ 성공: 'background_jobs' 테이블이 정상적으로 존재합니다!");
        process.exit(0);
    } catch (e: any) {
        console.error("❌ 스크립트 실행 중 오류:", e.message);
        process.exit(1);
    }
}

checkTable();
