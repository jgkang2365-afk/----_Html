import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { K2BService } from '@/lib/automation/k2b-service';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { checkPermission } from '@/lib/auth/check-permission';
import { findReportFiles } from '@/lib/utils/findReportFiles';
import { getSession } from '@/lib/auth/session';
import { getKSTDateString } from '@/lib/utils/date-utils';
import { syncBusinessToCalendar } from '@/lib/google/sync-service';
import { requireK2BJournalPersistence } from '@/lib/automation/k2b-upload-persistence';

/**
 * 기존 직접 실행형 K2B 업로드 API.
 * 주 UI 경로는 /api/report-processing/queue를 사용하지만 legacy 호출자의
 * 동기 응답 계약을 깨지 않도록 이 endpoint는 직접 실행 동작을 유지한다.
 */
export async function POST(req: NextRequest) {
    let guardJobId: string | null = null;
    let guardHeartbeat: ReturnType<typeof setInterval> | null = null;
    let uploadAttempted = false;
    let uploadExecuted = false;
    const admin = createAdminClient();
    try {
        await checkPermission('journal:write');
        const { targets } = await req.json();
        if (!targets || !Array.isArray(targets) || targets.length === 0) {
            return NextResponse.json({ error: '대상 업체가 없습니다.' }, { status: 400 });
        }

        const supabase = await createClient();
        const session = await getSession();
        if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

        const { data: dbUser } = await supabase
            .from('users')
            .select('name, k2b_id, k2b_pw')
            .eq('id', session.userId)
            .single();

        const { data: claimedJobId, error: claimError } = await admin.rpc('claim_k2b_legacy_direct_job', {
            p_payload: {
                trigger: 'legacy_direct',
                targetCount: targets.length,
                serializationDisposition: 'accepted_without_active_k2b',
            },
        });
        if (claimError) {
            const status = claimError.message.includes('ALREADY_ACTIVE') ? 409 : 500;
            return NextResponse.json({ error: claimError.message }, { status });
        }
        guardJobId = claimedJobId;
        guardHeartbeat = setInterval(() => {
            if (!guardJobId) return;
            void admin.from('background_jobs')
                .update({ updated_at: new Date().toISOString() })
                .eq('id', guardJobId)
                .eq('status', 'processing')
                .then(({ error }) => {
                    if (error) console.error('[K2B legacy guard heartbeat error]:', error.message);
                });
        }, 30_000);

        const k2b = new K2BService();
        const results: { code: string; success: boolean; status?: string; error?: string }[] = [];

        try {
            await k2b.init();
            await k2b.login(dbUser?.k2b_id, dbUser?.k2b_pw);

            for (const target of targets) {
                const files = findReportFiles({
                    year: target.year.toString(),
                    semester: target.period,
                    companyName: target.business_name,
                });
                uploadAttempted = true;
                const uploadRes = await k2b.uploadReport(target.business_name, {
                    dataFile: files.dataFile,
                    drawings: files.drawings,
                    drawingFolderPath: files.drawingFolderPath,
                });
                uploadExecuted = true;
                const updateData: Record<string, unknown> = { k2b_status: uploadRes.status };
                if (uploadRes.success) {
                    updateData.k2b_send_date = getKSTDateString();
                    updateData.k2b_sender = dbUser?.name;
                }
                await requireK2BJournalPersistence(
                    supabase
                        .from('measurement_journal')
                        .update(updateData)
                        .eq('code', target.code)
                        .eq('measurement_year', target.year)
                        .eq('measurement_period', target.period)
                );

                try {
                    await syncBusinessToCalendar(supabase, target.code, target.year, target.period);
                } catch (syncError) {
                    console.error(`[K2B Sync] Calendar sync failed for ${target.code}:`, syncError);
                }
                results.push({
                    code: target.code,
                    success: uploadRes.success,
                    status: uploadRes.status,
                    error: uploadRes.error,
                });
            }

            const gridResults = await k2b.extractResults();
            for (const gridResult of gridResults) {
                const matchTarget = targets.find((target: any) =>
                    gridResult.companyName.includes(target.business_name)
                    || target.business_name.includes(gridResult.companyName));
                if (!matchTarget) continue;

                const updateGridData: Record<string, unknown> = {
                    k2b_status: gridResult.status,
                    k2b_sender: dbUser?.name,
                };
                if (gridResult.status === '정상처리') {
                    updateGridData.k2b_send_date = getKSTDateString();
                }
                await requireK2BJournalPersistence(
                    supabase
                        .from('measurement_journal')
                        .update(updateGridData)
                        .eq('code', matchTarget.code)
                        .eq('measurement_year', matchTarget.year)
                        .eq('measurement_period', matchTarget.period)
                );

                try {
                    await syncBusinessToCalendar(supabase, matchTarget.code, matchTarget.year, matchTarget.period);
                } catch (syncError) {
                    console.error(`[K2B Sync] Calendar sync failed for ${matchTarget.code}:`, syncError);
                }
                const existingResult = results.find(result => result.code === matchTarget.code);
                if (existingResult) {
                    existingResult.status = gridResult.status;
                    if (gridResult.status === '정상처리') existingResult.success = true;
                }
            }
        } finally {
            await k2b.quit();
        }

        const successCount = results.filter(result => result.success).length;
        const { error: finishError } = await admin.from('background_jobs').update({
            status: successCount > 0 ? 'success' : 'failed',
            error_message: successCount > 0 ? null : 'K2B 전송 성공 건이 없습니다.',
            finished_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            execution_result: {
                trigger: 'legacy_direct',
                targetCount: targets.length,
                successCount,
                failedCount: results.length - successCount,
                uploadAttempted,
                uploadExecuted,
                serializationDisposition: 'accepted_without_active_k2b',
            },
        }).eq('id', guardJobId);
        if (finishError) throw finishError;
        return NextResponse.json({
            message: `K2B 전송 완료: ${successCount}/${results.length}개 성공`,
            results,
        });
    } catch (error: unknown) {
        if (guardJobId) {
            const { error: cleanupError } = await admin.from('background_jobs').update({
                status: 'failed',
                error_message: error instanceof Error ? error.message : 'K2B 처리 중 오류 발생',
                finished_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                execution_result: {
                    trigger: 'legacy_direct',
                    uploadAttempted,
                    uploadExecuted,
                    serializationDisposition: 'accepted_without_active_k2b',
                },
            }).eq('id', guardJobId);
            if (cleanupError) console.error('[K2B legacy guard cleanup error]:', cleanupError.message);
        }
        console.error('[K2B API Error]:', error);
        return NextResponse.json({
            error: error instanceof Error ? error.message : 'K2B 처리 중 오류 발생',
        }, { status: 500 });
    } finally {
        if (guardHeartbeat) clearInterval(guardHeartbeat);
    }
}
