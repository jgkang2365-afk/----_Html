import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { createSurveyEvent, updateSurveyEvent } from "./lib/google/calendar";

dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function runTest() {
    console.log("Starting test for 2026-01-12 businesses...");

    const { data: targets, error: targetError } = await supabase
        .from("measurement_target_business")
        .select("*")
        .eq("measurement_date", "2026-01-12");

    if (targetError || !targets) {
        console.error("Error fetching targets:", targetError);
        return;
    }

    console.log(`Found ${targets.length} targets.`);

    for (const target of targets) {
        const { code, year, period, business_name, address, google_event_id, plan_manager, measurer_id, notes, manager_mobile, phone } = target;

        console.log(`Processing ${business_name} (${code})...`);

        // Get Journal Status
        const { data: journal } = await supabase
            .from("measurement_journal")
            .select("k2b_send_date, electronic_invoice_date")
            .eq("code", code)
            .eq("measurement_year", year)
            .eq("measurement_period", period)
            .maybeSingle();

        const isCompleted = journal?.k2b_send_date && journal?.electronic_invoice_date;
        console.log(`  K2B: ${journal?.k2b_send_date}, Invoice: ${journal?.electronic_invoice_date} -> Completed: ${!!isCompleted}`);

        // Get Measurer Name
        let measurerName = plan_manager || "미지정";
        if (measurer_id) {
            const { data: userData } = await supabase.from("users").select("name").eq("id", measurer_id).single();
            if (userData) measurerName = userData.name;
        }

        // Color Logic
        const calendarColorMap: { [key: string]: string } = {
            '한기문': '10', '배윤민': '6', '강종구': '9', '이주형': '5', '고유빈': '7',
        };
        let colorId = calendarColorMap[measurerName];
        if (isCompleted) {
            colorId = '3'; // Grape
        }

        // Summary build (simplistic for test)
        const summary = `[${measurerName}]${business_name} ${isCompleted ? '(포도색 테스트)' : ''}`;
        const description = `테스트: K2B/계산서 완료 색상 변경\n사업장: ${business_name}\n주소: ${address}`;

        const eventData = {
            summary,
            description,
            date: target.measurement_date,
            location: address || "",
            colorId
        };

        if (google_event_id) {
            console.log(`  Updating event ${google_event_id}...`);
            await updateSurveyEvent(google_event_id, eventData);
        } else {
            console.log(`  Creating new event...`);
            const newEvent = await createSurveyEvent(eventData);
            if (newEvent?.id) {
                await supabase
                    .from("measurement_target_business")
                    .update({ google_event_id: newEvent.id })
                    .eq("id", target.id);
                console.log(`  Created event: ${newEvent.id}`);
            }
        }
    }

    console.log("Done.");
}

runTest();
