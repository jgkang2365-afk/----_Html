import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { updateSurveyEvent } from "./lib/google/calendar";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAPPING: Record<string, string> = {
    'H0020': '4k7m3hre9emofhov74tqfdt9o4', // 대성공업사
    'H0021': '28g9gc9qfjt9hhkuhen04735lv', // 대성모터스
    'H0018': '2mqoot6rdqc37dhmu6qggcal8c'  // 우정공업사
};

async function runFix() {
    console.log("Updating IDs and changing colors for 1/12 businesses...");

    for (const [code, eventId] of Object.entries(MAPPING)) {
        console.log(`Processing ${code} (EventID: ${eventId})...`);

        // 1. Update DB google_event_id
        await supabase
            .from("measurement_target_business")
            .update({ google_event_id: eventId })
            .eq("code", code)
            .eq("measurement_date", "2026-01-12");

        // 2. Clear old test ones if any (double check)
        // (already done in previous cleanup, but good to link now)

        // 3. Trigger Sync via code logic (mimic PATCH behavior)
        const { data: target } = await supabase
            .from("measurement_target_business")
            .select("*")
            .eq("code", code)
            .eq("measurement_date", "2026-01-12")
            .single();

        if (target) {
            // Get Journal Status
            const { data: journal } = await supabase
                .from("measurement_journal")
                .select("k2b_send_date, electronic_invoice_date")
                .eq("code", code)
                .eq("measurement_year", target.year)
                .eq("measurement_period", target.period)
                .maybeSingle();

            const isCompleted = journal?.k2b_send_date && journal?.electronic_invoice_date;

            let measurerName = target.plan_manager || "미지정";
            if (target.measurer_id) {
                const { data: userData } = await supabase.from("users").select("name").eq("id", target.measurer_id).single();
                if (userData) measurerName = userData.name;
            }

            const summary = `[${measurerName}]${target.business_name}`;
            const description = `사업장: ${target.business_name}\n주소: ${target.address || "주소 미입력"}\n담당자: ${measurerName}\n연락처: ${target.manager_mobile || target.phone || "없음"}\n비고: ${target.notes || ""}`.trim();

            const eventData = {
                summary,
                description,
                date: target.measurement_date,
                location: target.address || "",
                colorId: isCompleted ? '3' : '6' // Grape if completed
            };

            console.log(`  Updating Calendar Event to Color ${eventData.colorId}...`);
            await updateSurveyEvent(eventId, eventData);
        }
    }
    console.log("Finished.");
}

runFix();
