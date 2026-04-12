import { ImapFlow } from 'imapflow';
import { createClient } from "@/lib/supabase/server";

/**
 * 네이버 반송 메일 감지 엔진
 */
export class BounceChecker {
    private static instance: BounceChecker;
    
    private constructor() {}

    public static getInstance(): BounceChecker {
        if (!BounceChecker.instance) {
            BounceChecker.instance = new BounceChecker();
        }
        return BounceChecker.instance;
    }

    /**
     * 반송 메일 확인 및 처리 실행
     */
    public async checkBounces() {
        console.log(`[BounceChecker] 반송 메일 확인 시작: ${new Date().toLocaleString()}`);
        
        const client = new ImapFlow({
            host: 'imap.naver.com',
            port: 993,
            secure: true,
            auth: {
                user: process.env.NAVER_EMAIL_ID!,
                pass: process.env.NAVER_EMAIL_PW!
            },
            logger: false
        });

        try {
            await client.connect();
            
            // 받은편지함(INBOX) 선택
            let lock = await client.getMailboxLock('INBOX');
            try {
                // 최근 24시간 내의 메일 중 네이버 발송실패 안내 메일 검색
                const yesterday = new Date();
                yesterday.setDate(yesterday.getDate() - 1);
                
                // imapflow search query
                const messages = await client.search({
                    from: 'navermail_noreply@navercorp.com',
                    since: yesterday
                });

                if (messages.length === 0) {
                    console.log("[BounceChecker] 최근 24시간 내 반송 메일이 없습니다.");
                } else {
                    console.log(`[BounceChecker] ${messages.length}개의 후보 메일 발견.`);
                    for (const msgId of messages) {
                        await this.processMessage(client, msgId);
                    }
                }
            } finally {
                lock.release();
            }

            await client.logout();
            console.log("[BounceChecker] 확인 완료 및 로그아웃.");
        } catch (error) {
            console.error("[BounceChecker] 오류 발생:", error);
        }
    }

    private async processMessage(client: any, seq: number) {
        // 메일 제목과 본문 가져오기
        const message = await client.fetchOne(seq.toString(), { envelope: true, source: true });
        const subject = message.envelope.subject || "";
        
        // 제목 예시: [발송실패 안내] 'xxx@daum.net'로 메일이 전송되지 못했습니다.
        // 정규식으로 이메일 주소 추출
        const emailRegex = /'([^']+)'로 메일이 전송되지 못했습니다/;
        const match = subject.match(emailRegex);
        
        if (match && match[1]) {
            const targetEmail = match[1];
            console.log(`[BounceChecker] 반송 대상 식별: ${targetEmail}`);
            
            await this.handleBounce(targetEmail, subject);
        }
    }

    private async handleBounce(email: string, reason: string) {
        const supabase = await createClient();

        // 1. 해당 이메일을 사용하는 업체 찾기 (measurement_business)
        // 최근 발송된 건 위주로 매칭
        const { data: records, error } = await supabase
            .from('measurement_business')
            .select('code, business_name, year, period, manager_email')
            .eq('manager_email', email)
            .eq('is_email_sent', true)
            .order('last_email_sent_at', { ascending: false })
            .limit(1);

        if (error || !records || records.length === 0) {
            console.log(`[BounceChecker] 매칭되는 발송 기록을 찾을 수 없음: ${email}`);
            return;
        }

        const target = records[0];

        // 2. 상태 업데이트 (delivery_status)
        // 주의: delivery_status 컬럼이 없을 경우 에러가 발생할 수 있으므로 try-catch 또는 컬럼 존재 기반 처리
        try {
            const { error: updateError } = await supabase
                .from('measurement_business')
                .update({ 
                    // is_email_sent: false, // 다시 보내야 하므로 미발송 상태로? 
                    // 아니면 새로운 컬럼 사용:
                    delivery_status: 'bounced',
                    delivery_error: reason
                } as any)
                .eq('code', target.code)
                .eq('year', target.year)
                .eq('period', target.period);

            if (updateError) throw updateError;
            console.log(`[BounceChecker] DB 상태 업데이트 완료: ${target.business_name}`);
        } catch (e) {
            console.warn(`[BounceChecker] DB 업데이트 실패 (컬럼 누락 가능성): ${target.business_name}`);
            // 컬럼이 없더라도 알림은 보내야 함
        }

        // 3. 알림 생성 (모든 담당자에게)
        const { data: managers } = await supabase
            .from('users')
            .select('id')
            .eq('is_journal_manager', true);

        if (managers && managers.length > 0) {
            const notifications = managers.map(m => ({
                user_id: m.id,
                type: 'error',
                message: `[발송실패] ${target.business_name} (${target.year} ${target.period}) 보고서 메일이 반송되었습니다. 사유: ${reason}`,
                is_read: false
            }));

            await supabase.from('notifications').insert(notifications);
            console.log(`[BounceChecker] 알림 ${notifications.length}건 생성 완료.`);
        }
    }
}
