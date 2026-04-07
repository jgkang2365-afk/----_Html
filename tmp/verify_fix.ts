import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function verify() {
    const TEST_ID = 1251; // 존재하는 ID 사용
    const TEST_EMAIL = "verify_test@test.com";
    const TEST_DATE = "2026-04-07";

    console.log(`[Verification] Updating ID ${TEST_ID} with secondary info...`);
    
    // 1. 직접 DB 업데이트 (스키마 확인 겸)
    const { error: updateError } = await supabase
        .from("measurement_journal")
        .update({ 
            invoice_email_2: TEST_EMAIL,
            electronic_invoice_date_2: TEST_DATE
        })
        .eq("id", TEST_ID);

    if (updateError) {
        console.error("Update failed:", updateError.message);
        return;
    }

    // 2. FETCH back
    console.log("[Verification] Fetching back from DB...");
    const { data: journal, error: fetchError } = await supabase
        .from("measurement_journal")
        .select("invoice_email_2, electronic_invoice_date_2")
        .eq("id", TEST_ID)
        .single();

    if (fetchError) {
        console.error("Fetch failed:", fetchError.message);
        return;
    }

    if (journal.invoice_email_2 === TEST_EMAIL && journal.electronic_invoice_date_2 === TEST_DATE) {
        console.log("SUCCESS: Data persisted correctly in database.");
    } else {
        console.error("FAILURE: Data mismatch!", journal);
    }
}

verify();
