import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();
        const code = "H0438";
        const year = "2026";
        const period = "상반기";

        // 1. business_info 조회
        const { data: businessInfo } = await supabase
            .from("business_info")
            .select("*")
            .eq("code", code)
            .maybeSingle();

        // 2. measurement_business 이력 조회
        const { data: allBusinessHistory } = await supabase
            .from("measurement_business")
            .select("*")
            .eq("code", code)
            .order("year", { ascending: false })
            .order("period", { ascending: false });

        // Base Data 찾기
        let baseBusinessData = null;
        if (allBusinessHistory) {
            baseBusinessData = allBusinessHistory.find(
                (b: any) => b.year === parseInt(year) && b.period === period
            );
        }

        // Prioritized Defaults
        const findFirstValue = (field: string) => {
            if (!allBusinessHistory) return null;
            for (const record of allBusinessHistory) {
                if (record[field]) return record[field];
            }
            return null;
        };

        const prioritizedDefaults = {
            industrial_accident_number: findFirstValue("industrial_accident_number"),
            commencement_number: findFirstValue("commencement_number"),
        };

        // Journal Info
        let journalManagerInfo: Record<string, any> = {};
        const { data: recentJournals } = await supabase
            .from("measurement_journal")
            .select("industrial_accident_number, commencement_number")
            .eq("code", code)
            .order("measurement_year", { ascending: false })
            .order("measurement_period", { ascending: false })
            .limit(5);

        if (recentJournals && recentJournals.length > 0) {
            const fieldsToFind = ["industrial_accident_number", "commencement_number"];
            for (const field of fieldsToFind) {
                for (const journal of recentJournals) {
                    const val = (journal as any)[field];
                    if (val && !journalManagerInfo[field]) {
                        journalManagerInfo[field] = val;
                        break;
                    }
                }
            }
        }

        // Final Logic
        const finalSanjae = (baseBusinessData?.industrial_accident_number || "") || prioritizedDefaults.industrial_accident_number || journalManagerInfo?.industrial_accident_number || "";
        const finalCommencement = (baseBusinessData?.commencement_number || "") || prioritizedDefaults.commencement_number || journalManagerInfo?.commencement_number || "";

        return NextResponse.json({
            baseBusinessData: baseBusinessData || "Not Found",
            prioritizedDefaults,
            journalManagerInfo,
            finalSanjae,
            finalCommencement,
            baseSanjaeValue: baseBusinessData?.industrial_accident_number
        });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}
