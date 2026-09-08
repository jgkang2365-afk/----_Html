import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { getSession } from '@/lib/auth/session';
import { checkPermission } from '@/lib/auth/check-permission';
import { createAdminClient } from '@/lib/supabase/admin';
import { enqueueSerializedK2BUpload } from '@/lib/automation/k2b-job-queue';

/**
 * 백그라운드 작업 큐 등록 API
 */
export async function POST(req: NextRequest) {
    try {
        await checkPermission('journal:write');
        const session = await getSession();
        if (!session) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const { job_type, targets } = await req.json();

        if (!job_type || !['email', 'k2b'].includes(job_type)) {
            return NextResponse.json({ error: '올바르지 않은 작업 타입입니다.' }, { status: 400 });
        }

        if (!targets || !Array.isArray(targets) || targets.length === 0) {
            return NextResponse.json({ error: '처리할 대상 항목이 없습니다.' }, { status: 400 });
        }

        const supabase = createAdminClient();

        // 요청자 정보 조회
        const { data: dbUser } = await supabase
            .from('users')
            .select('id, name')
            .eq('id', session.userId)
            .single();

        const requestUser = dbUser ? { id: dbUser.id, name: dbUser.name } : { id: session.userId, name: '알 수 없음' };

        // 기존 K2B payload 구조는 보존하되, 검증 작업과 같은 durable RPC 잠금으로 등록한다.
        const payload = {
            targets,
            requestUser,
            calendarSyncApiUrl: job_type === 'k2b'
                ? new URL('/api/report-processing/calendar-sync', req.url).toString()
                : undefined
        };
        let jobId: string | number | undefined;
        if (job_type === 'k2b') {
            jobId = await enqueueSerializedK2BUpload(supabase, payload);
        } else {
            const { data: job, error: insertError } = await supabase
                .from('background_jobs')
                .insert({ job_type, status: 'pending', payload })
                .select('id')
                .single();
            if (insertError) throw insertError;
            jobId = job?.id;
        }

        return NextResponse.json({
            message: '백그라운드 작업 큐에 성공적으로 등록되었습니다.',
            jobId
        });

    } catch (error: any) {
        console.error('[Queue API Error]:', error);
        return NextResponse.json({ error: error.message || '작업 등록 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
