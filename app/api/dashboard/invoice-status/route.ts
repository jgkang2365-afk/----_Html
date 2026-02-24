import { NextResponse, NextRequest } from "next/server";
export const dynamic = 'force-dynamic';
import { createClient } from "@/lib/supabase/server";
import { checkPermission } from "@/lib/auth/check-permission";

export async function GET(request: NextRequest) {
    try {
        await checkPermission("dashboard:read");

        const { searchParams } = new URL(request.url);
        const yearParam = searchParams.get("year");
        const periodParam = searchParams.get("period");

        // 기본값 설정 (현재 년도/주기)
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentPeriod = now.getMonth() + 1 <= 6 ? "상반기" : "하반기";

        const targetYear = yearParam && yearParam !== "전체" ? parseInt(yearParam) : currentYear;
        const targetPeriod = periodParam && periodParam !== "전체" ? periodParam : currentPeriod;

        const supabase = await createClient();

        // 1. 측정 대상 사업장(계획) 조회 - 특정 3인 계획담당자 기준
        const targetManagers = ['한기문', '이주형', '강종구'];

        let query = supabase
            .from("measurement_target_business")
            .select("code, business_name, plan_manager, manager_name, manager_mobile, period, year")
            .in("plan_manager", targetManagers);

        if (yearParam && yearParam !== "전체") {
            query = query.eq("year", parseInt(yearParam));
        }

        if (periodParam && periodParam !== "전체") {
            query = query.ilike("period", `%${periodParam}%`);
        }

        const { data: businessTargets, error: businessError } = await query;

        if (businessError) throw businessError;

        // 2. 해당 기간의 측정일지(실제 등록 및 계산서 정보) 조회
        let jKQuery = supabase
            .from("measurement_journal")
            .select("code, measurement_year, measurement_period, electronic_invoice_date, k2b_send_date");

        if (yearParam && yearParam !== "전체") {
            jKQuery = jKQuery.eq("measurement_year", parseInt(yearParam));
        }

        if (periodParam && periodParam !== "전체") {
            jKQuery = jKQuery.ilike("measurement_period", `%${periodParam}%`);
        }

        const { data: journals, error: journalError } = await jKQuery;

        if (journalError) throw journalError;

        // 3. 데이터 매핑 및 집계 (Composite Key: code + year + period)
        const journalMap = new Map();
        journals?.forEach(j => {
            const key = `${j.code}_${j.measurement_year}_${j.measurement_period}`;
            journalMap.set(key, {
                registered: true,
                invoiceDate: j.electronic_invoice_date,
                k2bSendDate: j.k2b_send_date
            });
        });

        const statsMap: Record<string, any> = {};
        targetManagers.forEach(name => {
            statsMap[name] = {
                name,
                issued: 0,
                unissued_registered: 0,
                unissued_unregistered: 0,
                unissued_list: []
            };
        });

        businessTargets?.forEach(bt => {
            const manager = bt.plan_manager || '미지정';
            if (!statsMap[manager]) return;

            // Target의 period와 Journal의 measurement_period를 정확히 매칭하기 위해 key 생성
            const journalKey = `${bt.code}_${bt.year}_${bt.period}`;
            const journal = journalMap.get(journalKey);

            const companyInfo = {
                code: bt.code,
                business_name: bt.business_name,
                manager_name: bt.manager_name,
                manager_mobile: bt.manager_mobile,
                k2b_send_date: journal?.k2bSendDate || null,
                period: bt.period
            };

            if (journal) {
                if (journal.invoiceDate) {
                    statsMap[manager].issued += 1;
                } else {
                    statsMap[manager].unissued_registered += 1;
                    statsMap[manager].unissued_list.push({
                        ...companyInfo,
                        status: "일지등록/계산서미발행"
                    });
                }
            } else {
                statsMap[manager].unissued_unregistered += 1;
                statsMap[manager].unissued_list.push({
                    ...companyInfo,
                    status: "일지미등록"
                });
            }
        });

        return NextResponse.json({
            success: true,
            data: Object.values(statsMap)
        });

    } catch (error: any) {
        console.error("Invoice Status API Error:", error);
        return NextResponse.json({ error: "API 오류", details: error.message }, { status: 500 });
    }
}
