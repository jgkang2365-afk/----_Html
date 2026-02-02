import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://xjxqbwvcgffunqnkmoqw.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqeHFid3ZjZ2ZmdW5xbmttb3F3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc1MjMxOTksImV4cCI6MjA4MzA5OTE5OX0.tYWTU3Grv61w-iX8iPbVm7tCY8zf0bEeap-1RNYXfLI";
const supabase = createClient(supabaseUrl, supabaseKey);

async function check(name: string) {
    console.log(`\n========================================`);
    console.log(`Checking ${name}...`);
    const { data: journalData, error } = await supabase
        .from("measurement_journal")
        .select("*")
        .ilike("business_name", `%${name}%`)
        .order("measurement_end_date", { ascending: false });

    if (error) {
        console.error("Journal Error:", error);
        return;
    }

    if (!journalData || journalData.length === 0) {
        console.log("No journal data found.");
        return;
    }

    for (const item of journalData) {
        console.log(`\n[Journal Item] ID: ${item.id}`);
        console.log(`  Name: ${item.business_name}`);

        // Normalize logic same as route.ts
        const code = String(item.code || '').trim();
        const year = String(item.measurement_year || '').trim();
        const period = String(item.measurement_period || '').trim();

        console.log(`  Code: '${code}'`);
        console.log(`  Year: '${year}'`);
        console.log(`  Period: '${period}'`);
        console.log(`  Measurer (DB): '${item.measurer}'`);

        const { data: surveyData, error: surveyError } = await supabase
            .from("preliminary_survey")
            .select("*")
            .eq("code", item.code)
            .eq("year", item.measurement_year)
            .eq("period", item.measurement_period);

        if (surveyError) console.error("Survey Error:", surveyError);

        if (surveyData && surveyData.length > 0) {
            surveyData.forEach(s => {
                console.log(`\n  [MATCH Found in Survey]`);
                console.log(`    ReportWriter: '${s.report_writer}'`);
                console.log(`    Code: '${s.code}'`);
                console.log(`    Year: '${s.year}'`);
                console.log(`    Period: '${s.period}'`);
            });
        } else {
            console.log("\n  [NO MATCH] No record found in preliminary_survey with these exact raw values.");

            // Debug partial matches
            const { data: partialMatch } = await supabase.from("preliminary_survey").select("*").eq("code", item.code);
            if (partialMatch && partialMatch.length > 0) {
                console.log("  -> But found these records for the same Code:");
                partialMatch.forEach(p => console.log(`     Year: ${p.year}, Period: ${p.period}, Writer: ${p.report_writer}`));
            } else {
                console.log("  -> No records found even with just Code match.");
            }
        }
    }
}

async function run() {
    await check("대성모터스");
    await check("선우기업동부사업소");
}

run();
