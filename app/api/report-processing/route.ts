import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';

/**
 * 보고서 처리용 목록 조회 API
 */
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const year = searchParams.get('year');
        const period = searchParams.get('period');
        const search = searchParams.get('search');

        if (!year || !period) {
            return NextResponse.json({ error: '년도와 반기를 입력해주세요.' }, { status: 400 });
        }

        const supabase = await createClient();

        let query = supabase
            .from('measurement_business')
            .select('code, business_name, year, period, manager_email, is_email_sent, last_email_sent_at')
            .eq('year', parseInt(year))
            .eq('period', period)
            .not('business_name', 'ilike', '%번외%')
            .order('business_name', { ascending: true });

        if (search) {
            const searchTerms = search.split(',').map(t => t.trim()).filter(Boolean);
            if (searchTerms.length > 0) {
                const orConditions = searchTerms.map(term =>
                    `business_name.ilike.%${term}%,code.ilike.%${term}%`
                ).join(',');
                query = query.or(orConditions);
            }
        }

        const { data, error } = await query;

        if (error) {
            console.error('[API Error] 데이터 조회 실패:', error);
            return NextResponse.json({ error: '데이터베이스 조회 중 오류가 발생했습니다.' }, { status: 500 });
        }

        // 측정일지(journal)에서 K2B 전송일자 정보 가져와서 병합
        const codes = data.map(d => d.code);
        const { data: journals, error: jError } = await supabase
            .from('measurement_journal')
            .select('code, k2b_send_date, k2b_status')
            .in('code', codes)
            .eq('year', parseInt(year))
            .eq('period', period);

        const mergedData = data.map(record => {
            const journal = journals?.find(j => j.code === record.code);
            return {
                ...record,
                k2b_send_date: journal?.k2b_send_date || null,
                k2b_status: journal?.k2b_status || null
            };
        });

        return NextResponse.json({ records: mergedData });

    } catch (error) {
        console.error('[API Critical Error]:', error);
        return NextResponse.json({ error: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
    }
}
