import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/** 로컬 Worker Daemon에 작업 중단을 요청합니다. */
export async function POST(req: NextRequest) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

        const { jobId } = await req.json();
        if (!jobId) return NextResponse.json({ error: '작업 ID가 누락되었습니다.' }, { status: 400 });

        const supabase = await createClient();
        const { data: job, error: findError } = await supabase
            .from('background_jobs')
            .select('id, status, payload')
            .eq('id', jobId)
            .single();

        if (findError || !job) return NextResponse.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 });
        if (job.payload?.requestUser?.id !== session.userId) {
            return NextResponse.json({ error: '본인이 요청한 작업만 중단할 수 있습니다.' }, { status: 403 });
        }
        if (!['pending', 'processing'].includes(job.status)) {
            return NextResponse.json({ error: '이미 종료된 작업입니다.' }, { status: 409 });
        }

        const status = job.status === 'pending' ? 'cancelled' : 'cancel_requested';
        const { error: updateError } = await supabase
            .from('background_jobs')
            .update({ status, error_message: '사용자가 중단 요청을 실행했습니다.', updated_at: new Date().toISOString() })
            .eq('id', jobId)
            .eq('status', job.status);

        if (updateError) throw updateError;
        return NextResponse.json({ success: true, status });
    } catch (error: any) {
        return NextResponse.json({ error: error.message || '작업 중단 요청 중 오류가 발생했습니다.' }, { status: 500 });
    }
}
