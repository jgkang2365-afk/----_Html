import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const businessName = searchParams.get("name");

    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        return NextResponse.json({ error: "Missing Env Vars" }, { status: 500 });
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    if (!businessName) {
        return NextResponse.json({ error: "Name required" });
    }

    // 1. Get Journal Data
    const { data: journalData, error: journalError } = await supabase
        .from("measurement_journal")
        .select("*")
        .ilike("business_name", `%${businessName}%`)
        .order("measurement_end_date", { ascending: false });

    if (journalError) {
        return NextResponse.json({ error: journalError.message });
    }

    // 2. Get Survey Data matches
    const matches = [];
    if (journalData && journalData.length > 0) {
        for (const item of journalData) {
            // Normalize keys for display/checking
            const codeRaw = item.code;
            const yearRaw = item.measurement_year;
            const periodRaw = item.measurement_period;

            // Try EXACT match first as per current logic
            const { data: surveyData, error: surveyError } = await supabase
                .from("preliminary_survey_table")
                .select("*")
                .eq("code", item.code)
                .eq("year", item.measurement_year)
                .eq("period", item.measurement_period);

            matches.push({
                journal: {
                    id: item.id,
                    business_name: item.business_name,
                    code: codeRaw,
                    year: yearRaw,
                    period: periodRaw,
                    measurer: item.measurer,
                    end_date: item.measurement_end_date
                },
                surveyRaw: surveyData,
                surveyError: surveyError ? surveyError.message : null
            });
        }
    }

    return NextResponse.json({
        query: businessName,
        results: matches
    });
}
