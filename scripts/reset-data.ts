import { createClient } from "@/lib/supabase/client";

const supabase = createClient();

async function reset2026Data() {
    console.log("2026년 데이터 초기화 시작...");

    // 1. measurement_target_business (화면 표시 데이터) 삭제
    const { error: error1 } = await supabase
        .from("measurement_target_business")
        .delete()
        .eq("year", 2026);

    if (error1) console.error("target 삭제 실패:", error1);
    else console.log("measurement_target_business 2026년 데이터 삭제 완료");

    // 2. measurement_business (업로드 원본 데이터) 삭제
    const { error: error2 } = await supabase
        .from("measurement_business")
        .delete()
        .eq("year", 2026);

    if (error2) console.error("business 삭제 실패:", error2);
    else console.log("measurement_business 2026년 데이터 삭제 완료");
}

reset2026Data();
