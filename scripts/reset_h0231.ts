import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

// .env.local 로드
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!; // 삭제 권한을 위해 서비스 롤 키 우선 사용 시도, 없으면 anon 키
const supabase = createClient(supabaseUrl, supabaseKey);

async function resetH0231() {
    console.log("H0231 2026년 상반기 데이터 삭제(초기화) 시작...");

    // 1. 대상 조회 (정확히 '상반기'인 것만)
    const { data: targets, error: searchError } = await supabase
        .from("measurement_journal")
        .select("id, code, measurement_year, measurement_period, business_name")
        .eq("code", "H0231")
        .eq("measurement_year", 2026)
        .eq("measurement_period", "상반기");

    if (searchError) {
        console.error("조회 오류:", searchError);
        return;
    }

    console.log(`삭제 대상 데이터: ${targets?.length || 0}건`);

    if (targets && targets.length > 0) {
        targets.forEach(t => {
            console.log(` - ID: ${t.id}, ${t.code} / ${t.measurement_year} / ${t.measurement_period} / ${t.business_name}`);
        });

        // 2. 삭제
        const ids = targets.map((t) => t.id);
        const { error: deleteError } = await supabase
            .from("measurement_journal")
            .delete()
            .in("id", ids);

        if (deleteError) {
            console.error("삭제 오류:", deleteError);
        } else {
            console.log(`성공적으로 ${ids.length}건을 삭제하여 초기화했습니다.`);
            console.log("이제 조회 시 미등록 상태로 표시되며, 정기 측정 필터링 로직에 의해 빈 값으로 보일 것입니다.");
        }
    } else {
        console.log("삭제할 데이터가 없습니다. 이미 초기화(미등록) 상태입니다.");
    }
}

resetH0231();
