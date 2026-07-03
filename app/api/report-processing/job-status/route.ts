import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

/**
 * 백그라운드 작업 상태 조회 API
 */
export async function GET(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session) {
            return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const jobId = searchParams.get('id');

        if (!jobId) {
            return NextResponse.json({ error: '작업 ID가 누락되었습니다.' }, { status: 400 });
        }

        const supabase = await createClient();
        const { data: job, error } = await supabase
            .from('background_jobs')
            .select('status, error_message')
            .eq('id', jobId)
            .single();

        if (error) {
            throw error;
        }

        return NextResponse.json({
            status: job.status,
            errorMessage: job.error_message
        });

    } catch (error: any) {
        console.error('[Job Status API Error]:', error);
        return NextResponse.json({ error: error.message || '상태 조회 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
