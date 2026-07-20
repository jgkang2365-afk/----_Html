import { BounceChecker } from '../email/bounce-checker';
import { backupDatabase } from '../../scripts/backup-db';
import { createClient } from '../supabase/server';
import { getKSTISOString } from '../utils/date-utils';

const MES_QUEUE_ID = 1;
const MES_STALE_TIMEOUT_MINUTES = 15;
const MES_COMPLETION_TIMEOUT_MS = 12 * 60 * 1000;
const MES_STATUS_POLL_MS = 2000;
const KST_CRON_OPTIONS = { timezone: 'Asia/Seoul' };

/**
 * 전역 백그라운드 작업 관리자
 */
export class BackgroundTasks {
    private static instance: BackgroundTasks;
    private initialized: boolean = false;
    private mesSyncStatus: 'idle' | 'running' | 'success' | 'error' = 'idle';
    private mesSyncError: string | null = null;

    private constructor() {}

    public static getInstance(): BackgroundTasks {
        const globalRef = global as any;
        if (!globalRef.backgroundTasksInstance) {
            globalRef.backgroundTasksInstance = new BackgroundTasks();
        }
        return globalRef.backgroundTasksInstance;
    }

    /**
     * MES 동기화 상태를 조회하는 게터
     */
    public getMesSyncStatus() {
        return {
            status: this.mesSyncStatus,
            error: this.mesSyncError
        };
    }

    /**
     * 스케줄러 초기화 및 시작
     */
    public init() {
        if (this.initialized) {
            console.log("[BackgroundTasks] 이미 초기화되었습니다.");
            return;
        }

        console.log("[BackgroundTasks] 스케줄러 초기화 시작 (반송메일, DB백업 및 MES 자동화)...");

        // 0. 로컬 백그라운드 작업기(Worker Daemon) 가동
        try {
            const { WorkerDaemon } = require('../automation/worker-daemon');
            WorkerDaemon.getInstance().start();
        } catch (workerErr) {
            console.error("[BackgroundTasks] WorkerDaemon 가동 중 오류 발생:", workerErr);
        }

        // Webpack/Turbopack 빌드 에러 우회 (서버 환경에서만 런타임에 로드)
        let cron;
        try {
            cron = eval('require')('node-cron');
        } catch (e) {
            console.warn("[BackgroundTasks] node-cron 로드 실패. 스케줄러가 동작하지 않습니다.");
            return;
        }

        // 1. 반송 메일 체크 작업 (06:00, 12:00, 15:00, 18:00)
        // 크론 표현식: 0 6,12,15,18 * * *
        cron.schedule('0 6,12,15,18 * * *', async () => {
            await BounceChecker.getInstance().checkBounces();
        });

        // 2. DB 일일 자동 백업 작업 (02:15)
        // 크론 표현식: 15 2 * * *
        cron.schedule('15 2 * * *', async () => {
            try {
                console.log("[BackgroundTasks] 일일 자동 DB 백업을 시작합니다...");
                await backupDatabase();
            } catch (err: any) {
                console.error("[BackgroundTasks] 일일 자동 DB 백업 실행 실패:", err.message);
            }
        });

        // 3. MES 자동 다운로드 스케줄 (오전 11:30, 낮 12:00, 오후 14:00 최종 점검)
        cron.schedule('30 11 * * *', async () => {
            console.log("[BackgroundTasks] 11:30 MES 자동 다운로드 작업을 기동합니다...");
            await BackgroundTasks.getInstance().runMesDownloadScript(false);
        }, KST_CRON_OPTIONS);

        cron.schedule('0 12 * * *', async () => {
            console.log("[BackgroundTasks] 12:00 MES 자동 다운로드 작업을 기동합니다...");
            await BackgroundTasks.getInstance().runMesDownloadScript(false);
        }, KST_CRON_OPTIONS);

        cron.schedule('0 14 * * *', async () => {
            console.log("[BackgroundTasks] 14:00 최종 MES 자동 다운로드 및 연동 여부 점검을 기동합니다...");
            await BackgroundTasks.getInstance().runMesDownloadScript(true);
        }, KST_CRON_OPTIONS);

        this.initialized = true;
        console.log("[BackgroundTasks] 스케줄러 등록 완료 (반송 메일 & DB 백업 & MES 다운로드 3회 스케줄).");
    }

    /**
     * MES 다운로드 파이썬 스크립트 실행
     */
    public async runMesDownloadScript(isFinalCheck: boolean = false): Promise<boolean> {
        this.mesSyncStatus = 'running';
        this.mesSyncError = null;

        try {
            const supabase = await createClient();
            const timeoutLimit = new Date(
                Date.now() - MES_STALE_TIMEOUT_MINUTES * 60 * 1000
            ).toISOString();

            const { error: resetError } = await supabase
                .from('mes_sync_queue')
                .update({
                    status: 'idle',
                    error_message: MES_STALE_TIMEOUT_MINUTES + '분 초과 자동 작업을 리셋했습니다.',
                    requested_by: null,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', MES_QUEUE_ID)
                .in('status', ['pending', 'running'])
                .lt('updated_at', timeoutLimit);

            if (resetError) {
                console.warn('[BackgroundTasks] MES 큐 타임아웃 상태 리셋 실패:', resetError.message);
            }

            const { data: queued, error: queueError } = await supabase
                .from('mes_sync_queue')
                .update({
                    status: 'pending',
                    error_message: '자동 스케줄에 의해 요청된 MES 동기화입니다.',
                    requested_by: null,
                    updated_at: new Date().toISOString(),
                })
                .eq('id', MES_QUEUE_ID)
                .in('status', ['idle', 'success', 'error', 'cancelled'])
                .select('status')
                .maybeSingle();

            if (queueError) throw queueError;
            if (!queued) {
                throw new Error('다른 MES 동기화가 대기 중이거나 실행 중이어서 자동 요청을 시작하지 못했습니다.');
            }

            console.log('[BackgroundTasks] 관리자 권한 MES 데몬에 자동 다운로드 요청을 전달했습니다.');
            const startedAt = Date.now();

            while (Date.now() - startedAt < MES_COMPLETION_TIMEOUT_MS) {
                await new Promise(resolve => setTimeout(resolve, MES_STATUS_POLL_MS));

                const { data: queueState, error: statusError } = await supabase
                    .from('mes_sync_queue')
                    .select('status, error_message')
                    .eq('id', MES_QUEUE_ID)
                    .maybeSingle();

                if (statusError) throw statusError;
                if (queueState?.status === 'success') {
                    console.log('[BackgroundTasks] MES 자동 다운로드 및 DB 동기화가 완료되었습니다.');
                    if (isFinalCheck) {
                        await this.checkAndNotifyUnregisteredBusinesses();
                    }
                    this.mesSyncStatus = 'success';
                    return true;
                }

                if (['error', 'cancelled'].includes(queueState?.status || '')) {
                    throw new Error(queueState?.error_message || 'MES 자동 동기화가 ' + queueState?.status + ' 상태로 종료되었습니다.');
                }
            }

            throw new Error('MES 자동 동기화 완료 대기 시간이 12분을 초과했습니다.');
        } catch (error: any) {
            const message = error?.message || String(error);
            console.error('[BackgroundTasks] MES 자동 다운로드 요청 실패:', message);
            this.mesSyncStatus = 'error';
            this.mesSyncError = message;
            return false;
        }
    }

    /**
     * 14:00 최종 미등록 예비조사 업체 감지 및 일지담당자 알림 발송
     */
    public async checkAndNotifyUnregisteredBusinesses() {
        console.log("[BackgroundTasks] 14:00 최종 미등록 예비조사 업체 점검 시작...");
        const supabase = await createClient();
        
        // 당일 날짜 구하기 (KST 기준 YYYY-MM-DD)
        const kstToday = getKSTISOString().slice(0, 10);
        
        // 1. 오늘의 예비조사 목록 조회
        const { data: todaySurveys, error: surveyError } = await supabase
            .from("preliminary_survey")
            .select("code, business_name")
            .eq("measurement_date", kstToday);
            
        if (surveyError) {
            console.error("[BackgroundTasks] 예비조사 목록 조회 실패:", surveyError.message);
            return;
        }
        
        if (!todaySurveys || todaySurveys.length === 0) {
            console.log("[BackgroundTasks] 오늘 예정된 예비조사 업체 일정이 없습니다.");
            return;
        }
        
        // 2. 실제 적재된 측정대상 사업장 목록 조회
        const { data: mbRows, error: mbError } = await supabase
            .from("measurement_business")
            .select("code, business_name, business_number");
            
        if (mbError) {
            console.error("[BackgroundTasks] 측정대상 사업장 목록 조회 실패:", mbError.message);
            return;
        }
        
        const mbList = mbRows || [];
        const unregisteredNames: string[] = [];
        
        for (const survey of todaySurveys) {
            const sCode = String(survey.code || "").trim();
            const sName = String(survey.business_name || "").trim();
            
            // 매칭 비교 (3단계 알고리즘 대조)
            const isRegistered = mbList.some(row => {
                const rCode = String(row.code || "").trim();
                const rName = String(row.business_name || "").trim();
                
                // 1단계: 코드 매칭
                if (sCode && rCode && sCode === rCode) return true;
                // 2단계: 사업장명 매칭
                if (sName && rName) {
                    const cleanSName = sName.replace(/\s/g, "").replace(/\(주\)/g, "").replace(/주식회사/g, "");
                    const cleanRName = rName.replace(/\s/g, "").replace(/\(주\)/g, "").replace(/주식회사/g, "");
                    if (cleanSName === cleanRName || cleanRName.includes(cleanSName) || cleanSName.includes(cleanRName)) {
                        return true;
                    }
                }
                return false;
            });
            
            if (!isRegistered) {
                unregisteredNames.push(sName);
            }
        }
        
        if (unregisteredNames.length > 0) {
            console.log(`[BackgroundTasks] 14:00 최종 미등록 업체 감지: ${unregisteredNames.join(", ")}`);
            
            // 일지담당자(is_journal_manager = true) 목록 조회
            const { data: managers } = await supabase
                .from("users")
                .select("id")
                .eq("is_journal_manager", true);
                
            const managerIds = (managers || []).map(m => m.id);
            
            if (managerIds.length > 0) {
                const notiMsg = `[MES 미등록 경고] '${unregisteredNames[0]}'${unregisteredNames.length > 1 ? ` 외 ${unregisteredNames.length - 1}개` : ''} 업체가 금일 14:00까지 MES에 등록되지 않았습니다. 기사의 당일 등록 확인이 필요합니다.`;
                
                const notis = managerIds.map(mId => ({
                    user_id: mId,
                    type: "mes_sync_warning",
                    message: notiMsg,
                    is_read: false
                }));
                
                await supabase.from("notifications").insert(notis);
                console.log("[BackgroundTasks] 일지담당자 대상 최종 미등록 누락 알림 생성 완료.");
            }
        } else {
            console.log("[BackgroundTasks] 오늘 예정된 모든 예비조사 업체가 정상 등록 및 연동 완료되었습니다.");
        }
    }
}
