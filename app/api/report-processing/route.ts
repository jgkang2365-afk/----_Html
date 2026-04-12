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
        
        // 1. 기본 쿼리 생성
        let query = supabase
            .from('measurement_business')
            .select('code, business_name, year, period, manager_email, is_email_sent, last_email_sent_at, delivery_status, delivery_error')
            .not('business_name', 'ilike', '%번외%');

        // 2. 필터 적용 (year/period가 'all'이 아닌 경우에만)
        if (year !== 'all') {
            query = query.eq('year', parseInt(year));
        }
        if (period !== 'all') {
            query = query.eq('period', period);
        }

        // 3. 검색어 적용
        if (search) {
            const searchTerms = search.split(',').map(t => t.trim()).filter(Boolean);
            if (searchTerms.length > 0) {
                const orConditions = searchTerms.map(term =>
                    `business_name.ilike.%${term}%,code.ilike.%${term}%`
                ).join(',');
                query = query.or(orConditions);
            }
        }

        const { data, error } = await query.order('business_name', { ascending: true });

        if (error) {
            console.error('[API Error] 데이터 조회 실패:', error);
            return NextResponse.json({ error: '데이터베이스 조회 중 오류가 발생했습니다.' }, { status: 500 });
        }

        if (data.length === 0) {
            return NextResponse.json({ records: [] });
        }

        // 4. 측정일지(journal)에서 K2B 정보 가져오기
        // 여러 연도/주기가 섞여 있을 수 있으므로 code, year, period로 매칭해야 함
        const codes = Array.from(new Set(data.map(d => d.code)));
        
        let journalQuery = supabase
            .from('measurement_journal')
            .select('code, measurement_year, measurement_period, k2b_send_date, k2b_status')
            .in('code', codes);

        // 연도/주기 필터가 있으면 조인 쿼리에도 적용하여 효율화
        if (year !== 'all') journalQuery = journalQuery.eq('measurement_year', parseInt(year));
        if (period !== 'all') journalQuery = journalQuery.eq('measurement_period', period);

        const { data: journals, error: jError } = await journalQuery;

        // 5. 데이터 병합
        const mergedData = data.map(record => {
            const journal = journals?.find(j => 
                j.code === record.code && 
                j.measurement_year === record.year && 
                j.measurement_period === record.period
            );
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
