import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { K2BService } from '@/lib/automation/k2b-service';
import { createClient } from '@/lib/supabase/server';
import { findReportFiles } from '@/lib/utils/findReportFiles';
import { getSession } from '@/lib/auth/session';

/**
 * K2B 보고서 업로드 API
 */
export async function POST(req: NextRequest) {
    try {
        const { targets } = await req.json();

        if (!targets || !Array.isArray(targets) || targets.length === 0) {
            return NextResponse.json({ error: '대상 업체가 없습니다.' }, { status: 400 });
        }

        const supabase = await createClient();

        // 현재 세션의 사용자 ID로 K2B 계정 정보 조회
        const session = await getSession();
        if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

        const { data: dbUser } = await supabase
            .from('users')
            .select('k2b_id, k2b_pw')
            .eq('id', session.userId)
            .single();

        const k2b = new K2BService();
        const results = [];

        try {
            await k2b.init();
            // DB에서 가져온 개별 계정 사용
            await k2b.login(dbUser?.k2b_id, dbUser?.k2b_pw);

            for (const target of targets) {
                // 1. 파일 찾기
                const files = await findReportFiles({
                    year: target.year.toString(),
                    semester: target.period,
                    companyName: target.business_name
                });

                if (!files.report) {
                    results.push({ code: target.code, success: false, error: '보고서 파일을 찾을 수 없습니다.' });
                    continue;
                }

                // 2. K2B 업로드 실행
                const uploadRes = await k2b.uploadReport(target.business_name, files.report.path);

                if (uploadRes.success) {
                    // 3. DB 업데이트 (K2B 전송일자)
                    const now = new Date().toISOString().split('T')[0];
                    await supabase
                        .from('measurement_journal')
                        .update({ k2b_send_date: now })
                        .eq('code', target.code)
                        .eq('year', target.year)
                        .eq('period', target.period);

                    results.push({ code: target.code, success: true });
                } else {
                    results.push({ code: target.code, success: false, error: uploadRes.error });
                }
            }
        } finally {
            await k2b.quit();
        }

        const successCount = results.filter(r => r.success).length;
        return NextResponse.json({
            message: `${successCount}개 업체의 K2B 업로드 프로세스가 완료되었습니다.`,
            results
        });

    } catch (error: any) {
        console.error('[K2B API Error]:', error);
        return NextResponse.json({ error: error.message || 'K2B 처리 중 오류 발생' }, { status: 500 });
    }
}
