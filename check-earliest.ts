import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkEarliestEvent() {
    console.log("Checking earliest google_event_id in measurement_target_business...");

    // google_event_id가 있는 레코드 중 measurement_date가 가장 이른 것 찾기 (1/12 제외 테스트용이었으니)
    const { data, error } = await supabase
        .from("measurement_target_business")
        .select("measurement_date, business_name, google_event_id")
        .not("google_event_id", "is", null)
        .neq("measurement_date", "2026-01-12") // 테스트 일자 제외
        .order("measurement_date", { ascending: true })
        .limit(5);

    if (error) {
        console.error("Error:", error);
        return;
    }

    if (data && data.length > 0) {
        console.log("Earliest real events linked:");
        data.forEach(t => {
            console.log(`- ${t.measurement_date}: ${t.business_name} (${t.google_event_id})`);
        });
    } else {
        console.log("No other linked events found.");
    }
}

checkEarliestEvent();
