import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();

        // 1. Get preliminary surveys (Limit to recent ones to avoid timeout)
        const { data: surveys, error: surveyError } = await supabase
            .from("preliminary_survey")
            .select("id, code, year, period, business_name")
            .eq("year", 2026) // Optimize: Focus on current year
            .limit(100);

        if (surveyError) throw surveyError;

        if (!surveys || surveys.length === 0) {
            return NextResponse.json({ message: "No preliminary surveys found." });
        }

        const mismatches = [];

        // 2. Check against measurement_target_business
        for (const survey of surveys) {
            if (!survey.code) continue;

            const { data: target, error: targetError } = await supabase
                .from("measurement_target_business")
                .select("business_name")
                .eq("code", survey.code)
                .eq("year", survey.year)
                .eq("period", survey.period)
                .single();

            if (targetError && targetError.code !== 'PGRST116') { // Ignore not found for now
                console.error(`Error fetching target for ${survey.code}:`, targetError);
                continue;
            }

            if (target) {
                // Compare names (stripping spaces for loose comparison)
                const surveyName = survey.business_name?.trim() || "";
                const targetName = target.business_name?.trim() || "";

                if (surveyName !== targetName) {
                    mismatches.push({
                        surveyId: survey.id,
                        code: survey.code,
                        year: survey.year,
                        period: survey.period,
                        surveyName: surveyName,
                        targetName: targetName
                    });
                }
            }
        }

        return NextResponse.json({
            count: mismatches.length,
            mismatches
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
