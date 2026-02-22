import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { EmailService } from '@/lib/email/email-service';
import { findReportFiles } from '@/lib/utils/findReportFiles';

/**
 * 보고서 메일 일괄 발송 API
 */
export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const {
            targets, // { code, year, period, companyName, managerEmail }[]
            senderId // 발송자 ID (선택)
        } = await req.json();

        if (!targets || !Array.isArray(targets) || targets.length === 0) {
            return NextResponse.json({ error: '발송 대상이 없습니다.' }, { status: 400 });
        }

        const emailService = new EmailService();
        const results = [];

        for (const target of targets) {
            const { code, year, period, companyName, managerEmail } = target;

            try {
                // 1. 파일 찾기
                const files = findReportFiles({ year: String(year), semester: period, companyName });

                if (!files.report) {
                    results.push({ code, companyName, success: false, error: '보고서 PDF 파일을 찾을 수 없습니다.' });
                    continue;
                }

                const attachments = [files.report];
                if (files.invoice) {
                    attachments.push(files.invoice);
                }

                // 2. 메일 발송
                await emailService.sendReportEmail({
                    to: managerEmail,
                    companyName,
                    year: String(year),
                    semester: period,
                    attachments: attachments.map(f => ({ filename: f.filename, path: f.path })),
                });

                // 3. DB 상태 업데이트 (measurement_business)
                await supabase
                    .from('measurement_business')
                    .update({
                        is_email_sent: true,
                        last_email_sent_at: new Date().toISOString(),
                    })
                    .eq('code', code)
                    .eq('year', year)
                    .eq('period', period);

                // 4. DB 상태 업데이트 (measurement_journal - 동기화)
                await supabase
                    .from('measurement_journal')
                    .update({
                        is_email_sent: true,
                        last_email_sent_at: new Date().toISOString(),
                    })
                    .eq('code', code)
                    .eq('year', year)
                    .eq('period', period);

                results.push({ code, companyName, success: true });
            } catch (err) {
                console.error(`[API Error] ${companyName} 발송 실패:`, err);
                results.push({
                    code,
                    companyName,
                    success: false,
                    error: err instanceof Error ? err.message : '알 수 없는 오류'
                });
            }
        }

        return NextResponse.json({
            message: `${targets.length}건 중 ${results.filter(r => r.success).length}건 발송 성공`,
            results
        });

    } catch (error) {
        console.error('[API Critical Error]:', error);
        return NextResponse.json({ error: '서버 내부 오류가 발생했습니다.' }, { status: 500 });
    }
}
