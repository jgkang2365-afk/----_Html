import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { K2BService } from '@/lib/automation/k2b-service';
import { createClient } from '@/lib/supabase/server';
import { findReportFiles } from '@/lib/utils/findReportFiles';
import { getSession } from '@/lib/auth/session';

/**
 * K2B 보고서 업로드 API
 * 파이썬 스크립트의 connect_to_k2b 프로세스를 1:1 이식한 API
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
        const results: { code: string; success: boolean; status?: string; error?: string }[] = [];

        try {
            await k2b.init();
            // DB에서 가져온 개별 계정으로 로그인 및 파일전송(신) 진입
            await k2b.login(dbUser?.k2b_id, dbUser?.k2b_pw);

            // 업체별 반복 처리 (파이썬 for company_name in selections 루프 대응)
            for (const target of targets) {
                // 1. 파일 찾기 (보고서, 데이터 파일, 도면 등)
                const files = findReportFiles({
                    year: target.year.toString(),
                    semester: target.period,
                    companyName: target.business_name
                });

                // 2. K2B 업로드 실행 (데이터 파일, 도면, 도면 폴더 경로 전달)
                const uploadRes = await k2b.uploadReport(target.business_name, {
                    dataFile: files.dataFile,
                    drawings: files.drawings,
                    drawingFolderPath: files.drawingFolderPath
                });

                // 3. DB 업데이트 (K2B 전송일자 및 상태)
                const now = new Date().toISOString().split('T')[0];
                const updateData: Record<string, any> = {
                    k2b_status: uploadRes.status // 항상 상태를 갱신
                };

                if (uploadRes.success) {
                    updateData.k2b_send_date = now;
                }

                await supabase
                    .from('measurement_journal')
                    .update(updateData)
                    .eq('code', target.code)
                    .eq('measurement_year', target.year)
                    .eq('measurement_period', target.period);

                results.push({
                    code: target.code,
                    success: uploadRes.success,
                    status: uploadRes.status,
                    error: uploadRes.error
                });
            }

            // 파이썬 스크립트 동일: 모든 업체 처리 후 10초 대기 → 접수 현황 조회
            const gridResults = await k2b.extractResults();

            // 그리드 결과를 기반으로 DB 상태를 업데이트 (파이썬의 log_company_status 로직)
            for (const gr of gridResults) {
                // 해당 업체가 대상 목록에 있으면 그리드 결과로 상태 갱신
                const matchTarget = targets.find((t: any) =>
                    gr.companyName.includes(t.business_name) || t.business_name.includes(gr.companyName)
                );
                if (matchTarget) {
                    await supabase
                        .from('measurement_journal')
                        .update({ k2b_status: gr.status })
                        .eq('code', matchTarget.code)
                        .eq('measurement_year', matchTarget.year)
                        .eq('measurement_period', matchTarget.period);

                    // results 배열에도 반영
                    const existingResult = results.find(r => r.code === matchTarget.code);
                    if (existingResult) {
                        existingResult.status = gr.status;
                        // "정상처리" 또는 "업로드 완료" 이면 성공으로 간주
                        if (gr.status === '정상처리' || gr.status === '업로드 완료') {
                            existingResult.success = true;
                        }
                    }
                }
            }

            // 브라우저는 파이썬 동일하게 유지 (오류 시에만 종료)
            // await k2b.quit(); → 정상 완료 시 브라우저 유지

        } catch (e: any) {
            console.error('[K2B] 자동화 오류:', e.message);
            // 오류 발생 시에만 브라우저 닫기
            await k2b.quit();
            throw e;
        }

        const successCount = results.filter(r => r.success).length;
        return NextResponse.json({
            message: `K2B 전송 완료: ${successCount}/${results.length}개 성공`,
            results
        });

    } catch (error: any) {
        console.error('[K2B API Error]:', error);
        return NextResponse.json({ error: error.message || 'K2B 처리 중 오류 발생' }, { status: 500 });
    }
}
