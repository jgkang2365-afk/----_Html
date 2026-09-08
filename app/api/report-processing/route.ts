import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { unstable_noStore as noStore } from 'next/cache';
import {
    isReportProcessingTargetActive,
    matchesReportProcessingMeasurementDate,
    measurementDatesForReportProcessing,
} from '@/lib/report-processing/measurement-dates';
import { REPORT_PROCESSING_EXCLUDED_BUSINESS_NAME_PATTERN } from '@/lib/report-processing/scope';
import { isValidDateString } from '@/lib/utils/date-validator';

/**
 * 보고서 처리용 목록 조회 API
 */
export async function GET(req: NextRequest) {
    noStore();
    try {
        const { searchParams } = new URL(req.url);
        const year = searchParams.get('year');
        const period = searchParams.get('period');
        const measurementDate = searchParams.get('measurementDate');
        const search = searchParams.get('search');

        if (!year || !period) {
            return NextResponse.json({ error: '년도와 반기를 입력해주세요.' }, { status: 400 });
        }
        if (measurementDate && !isValidDateString(measurementDate)) {
            return NextResponse.json({ error: '측정일 형식을 확인해주세요.' }, { status: 400 });
        }

        const supabase = await createClient();
        
        // 1. 기본 쿼리 생성
        let query = supabase
            .from('measurement_business')
            .select('code, business_name, year, period, manager_email, is_email_sent, last_email_sent_at, delivery_status, delivery_error')
            .not('business_name', 'ilike', REPORT_PROCESSING_EXCLUDED_BUSINESS_NAME_PATTERN);

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

        // 4. 여러 연도/주기가 섞여 있을 수 있으므로 code, year, period로 매칭한다.
        const codes = Array.from(new Set(data.map(d => d.code)));

        // 측정일은 업체별 추가 조회가 아닌 target 일정 일괄 조회로 가져온다.
        let targetQuery = supabase
            .from('measurement_target_business')
            .select('code, year, period, measurement_date, daily_staff, is_registered')
            .in('code', codes);

        if (year !== 'all') targetQuery = targetQuery.eq('year', parseInt(year));
        if (period !== 'all') targetQuery = targetQuery.eq('period', period);

        const { data: targets, error: targetError } = await targetQuery;
        if (targetError) {
            console.error('[API Error] 측정 대상 일정 조회 실패:', targetError);
            return NextResponse.json({ error: '측정일 일정 조회 중 오류가 발생했습니다.' }, { status: 500 });
        }

        const targetsByRecord = new Map(
            (targets ?? []).map((target) => [
                `${target.code}-${target.year}-${target.period}`,
                target,
            ]),
        );
        
        let journalQuery = supabase
            .from('measurement_journal')
            .select('code, measurement_year, measurement_period, k2b_send_date, k2b_status, k2b_verified_status, k2b_verified_at, k2b_verified_send_date, k2b_consistency_status, k2b_consistency_note')
            .in('code', codes);

        // 연도/주기 필터가 있으면 조인 쿼리에도 적용하여 효율화
        if (year !== 'all') journalQuery = journalQuery.eq('measurement_year', parseInt(year));
        if (period !== 'all') journalQuery = journalQuery.eq('measurement_period', period);

        const { data: journals, error: jError } = await journalQuery;

        // 5. target이 있으면 현재 lifecycle(실시)만 표시한다.
        // target이 없는 과거 행은 기본 조회에서 유지하되, 날짜 조건에는 포함하지 않는다.
        const mergedData = data.flatMap(record => {
            const target = targetsByRecord.get(`${record.code}-${record.year}-${record.period}`);
            if (target && !isReportProcessingTargetActive(target)) return [];

            const journal = journals?.find(j => 
                j.code === record.code && 
                j.measurement_year === record.year && 
                j.measurement_period === record.period
            );
            const measurement_dates = target ? measurementDatesForReportProcessing(target) : [];
            if (!matchesReportProcessingMeasurementDate(measurement_dates, measurementDate)) return [];

            return [{
                ...record,
                measurement_dates,
                k2b_send_date: journal?.k2b_send_date || null,
                k2b_status: journal?.k2b_status || null,
                k2b_verified_status: journal?.k2b_verified_status || 'UNVERIFIED',
                k2b_verified_at: journal?.k2b_verified_at || null,
                k2b_verified_send_date: journal?.k2b_verified_send_date || null,
                k2b_consistency_status: journal?.k2b_consistency_status || 'UNVERIFIED',
                k2b_consistency_note: journal?.k2b_consistency_note || '실제결과 미검증'
            }];
        });

        const response = NextResponse.json({ records: mergedData });
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('Expires', '0');
        return response;


    } catch (error) {
        console.error('[API Critical Error]:', error);
        return NextResponse.json({ error: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
    }
}
