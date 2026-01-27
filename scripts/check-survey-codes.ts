
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase URL or Key");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkUsers() {
    console.log("Checking users survey_code...");
    const { data: users, error } = await supabase
        .from("users")
        .select("id, name, email, role, survey_code");

    if (error) {
        console.error("Error fetching users:", error);
        return;
    }

    console.log("Users:", JSON.stringify(users, null, 2));
}

async function checkSurveys() {
    console.log("Checking preliminary_survey survey_code breakdown...");
    const { data: surveys, error } = await supabase
        .from("preliminary_survey")
        .select("id, business_name, measurer, survey_code");

    if (error) {
        console.error("Error fetching surveys:", error);
        return;
    }

    // 통계
    const counts: Record<string, number> = {};
    surveys?.forEach((s: any) => {
        const code = s.survey_code || "NULL";
        counts[code] = (counts[code] || 0) + 1;
    });

    console.log("Survey Code Counts:", JSON.stringify(counts, null, 2));

    // 이상한 값 샘플 출력
    const weirdCodes = surveys?.filter((s: any) => {
        const code = s.survey_code;
        return code && !["A", "B", "C", "D", "E", "F"].includes(code);
    });

    if (weirdCodes && weirdCodes.length > 0) {
        console.log("Weird Survey Code Samples:", JSON.stringify(weirdCodes.slice(0, 20), null, 2));
    } else {
        console.log("No weird survey codes found (All are A-F or NULL).");
    }
}

async function main() {
    await checkUsers();
    await checkSurveys();
}

main();
