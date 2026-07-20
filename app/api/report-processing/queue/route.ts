import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

/**
 * 백그라운드 작업 큐 등록 API
 */
export async function POST(req: NextRequest) {
    try {
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

        const supabase = await createClient();

        // 요청자 정보 조회
        const { data: dbUser } = await supabase
            .from('users')
            .select('id, name')
            .eq('id', session.userId)
            .single();

        const requestUser = dbUser ? { id: dbUser.id, name: dbUser.name } : { id: session.userId, name: '알 수 없음' };

        // background_jobs 테이블에 작업 등록
        const { data: job, error: insertError } = await supabase
            .from('background_jobs')
            .insert({
                job_type,
                status: 'pending',
                payload: {
                    targets,
                    requestUser
                }
            })
            .select('id')
            .single();

        if (insertError) {
            throw insertError;
        }

        return NextResponse.json({
            message: '백그라운드 작업 큐에 성공적으로 등록되었습니다.',
            jobId: job.id
        });

    } catch (error: any) {
        console.error('[Queue API Error]:', error);
        return NextResponse.json({ error: error.message || '작업 등록 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
