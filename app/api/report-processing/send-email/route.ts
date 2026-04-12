import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { EmailService } from '@/lib/email/email-service';
import { findReportFiles } from '@/lib/utils/findReportFiles';
import { getKSTISOString } from '@/lib/utils/date-utils';

/**
 * 보고서 메일 일괄 발송 API
 */
export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient();
        const body = await req.json();
        const targets = body.targets || [];
        // senderId는 현재 사용하지 않음

        if (!targets || !Array.isArray(targets) || targets.length === 0) {
            return NextResponse.json({ error: '발송 대상이 없습니다.' }, { status: 400 });
        }

        const emailService = new EmailService();
        const results = [];

        for (const target of targets) {
            // target 구조: { business_name, manager_email, reports: [{ year, period, code }] }
            const { business_name, manager_email, reports } = target;

            if (!reports || !Array.isArray(reports) || reports.length === 0) {
                results.push({ companyName: business_name, success: false, error: '발송할 보고서 정보가 없습니다.' });
                continue;
            }

            try {
                const allAttachments: { filename: string; path: string }[] = [];
                const processedReports: typeof reports = [];

                // 1. 모든 보고서 파일 취합
                for (const report of reports) {
                    const rowFiles = findReportFiles({ 
                        year: String(report.year), 
                        semester: report.period, 
                        companyName: business_name 
                    });

                    if (rowFiles.report) {
                        allAttachments.push({ filename: rowFiles.report.filename, path: rowFiles.report.path });
                        if (rowFiles.invoice) {
                            allAttachments.push({ filename: rowFiles.invoice.filename, path: rowFiles.invoice.path });
                        }
                        processedReports.push(report);
                    } else {
                        console.warn(`[File Not Found] ${business_name} ${report.year}-${report.period}`);
                    }
                }

                if (allAttachments.length === 0) {
                    results.push({ 
                        companyName: business_name, 
                        success: false, 
                        error: '첨부할 가용한 보고서 파일이 없습니다.' 
                    });
                    continue;
                }

                // 2. 메일 발송
                await emailService.sendReportEmail({
                    to: manager_email,
                    companyName: business_name,
                    reports: processedReports.map(r => ({ year: String(r.year), period: r.period })),
                    attachments: allAttachments,
                    // isAdditional 판별: 1개 초과이거나, (기능 확장성 위해 필요시 프론트에서 넘겨준 값 활용 가능)
                });

                // 3. DB 상태 업데이트 (모든 성공 항목에 대해)
                for (const r of processedReports) {
                    // measurement_business 업데이트
                    await supabase
                        .from('measurement_business')
                        .update({
                            is_email_sent: true,
                            last_email_sent_at: getKSTISOString(),
                        })
                        .eq('code', r.code)
                        .eq('year', r.year)
                        .eq('period', r.period);

                    // measurement_journal 업데이트
                    await supabase
                        .from('measurement_journal')
                        .update({
                            is_email_sent: true,
                            last_email_sent_at: getKSTISOString(),
                        })
                        .eq('code', r.code)
                        .eq('measurement_year', r.year)
                        .eq('measurement_period', r.period);
                }

                results.push({ companyName: business_name, success: true, count: processedReports.length });
            } catch (err) {
                console.error(`[API Error] ${business_name} 발송 실패:`, err);
                results.push({
                    companyName: business_name,
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
