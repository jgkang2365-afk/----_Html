import { BounceChecker } from '../email/bounce-checker';
import { backupDatabase } from '../../scripts/backup-db';
import { createAdminClient } from '../supabase/admin';
import { getKSTDateString } from '../utils/date-utils';
import { K2B_VERIFY_SCHEDULE } from '../constants/k2b-verification';
import { buildK2BSyncRange, K2B_SYNC_OVERLAP_DAYS } from '../automation/k2b-original-sync';
import { enqueueAutomationJob, mesScheduledIdempotencyKey, nationalSupportIdempotencyKey } from '../automation/jobs';
import { hasMeasurementJournalForTarget } from '../national-support/automation-contract';
import { hasNationalSupportApplicationInformation } from '../national-support/eligibility';

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
            const { LocalAutomationWorker } = require('../automation/local-automation-worker');
            LocalAutomationWorker.getInstance().start();
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

        // The local server drains DB-only post actions independently of the
        // Windows MES worker.  Pending retries remain durable in Postgres.
        cron.schedule('*/5 * * * *', async () => {
            try {
                const { error } = await createAdminClient().rpc('process_mes_post_sync_checks', { p_limit: 100 });
                if (error) throw error;
            } catch (error) {
                console.error('[BackgroundTasks] MES 후속 점검 처리 실패:', error);
            }
        });

        cron.schedule('0 17 * * *', async () => {
            await this.enqueueDailyNationalSupportChecks();
        }, KST_CRON_OPTIONS);

        // 4. 전일 K2B 실제 결과 검증. 큐 RPC가 업로드와의 활성 작업 충돌 및 날짜 중복을 막는다.
        cron.schedule(K2B_VERIFY_SCHEDULE, async () => {
            await this.enqueueDailyK2BVerification();
        }, KST_CRON_OPTIONS);

        this.initialized = true;
        console.log("[BackgroundTasks] 스케줄러 등록 완료 (반송 메일 & DB 백업 & MES 다운로드 3회 스케줄).");
    }

    public async enqueueDailyK2BVerification(): Promise<string | null> {
        try {
            const supabase = createAdminClient();
            const { data: state, error: stateError } = await supabase.from('k2b_sync_state')
                .select('last_successful_through_date').eq('state_key', 'default').maybeSingle();
            if (stateError) throw stateError;
            const range = buildK2BSyncRange({ trigger: 'scheduled', today: getKSTDateString(), lastSuccessfulThroughDate: state?.last_successful_through_date ?? null });
            const { data, error } = await supabase.rpc('enqueue_k2b_original_sync_job', { p_payload: {
                trigger: 'scheduled', fromDate: range.fromDate, toDate: range.toDate, requestedBy: null, cursorEligible: true, serializationDisposition: 'accepted_without_active_k2b',
            } });
            if (error) {
                if (error.message.includes('K2B_AUTOMATION_ALREADY_ACTIVE')) {
                    console.log(`[BackgroundTasks] K2B 원본 동기화 보류: 업로드/동기화 작업이 활성 상태입니다. overlap=${K2B_SYNC_OVERLAP_DAYS}`);
                    return null;
                }
                throw error;
            }
            console.log(`[BackgroundTasks] K2B 원본 동기화(${range.fromDate}..${range.toDate})를 등록했습니다. overlap=${K2B_SYNC_OVERLAP_DAYS}`);
            return data as string;
        } catch (error: any) {
            console.error('[BackgroundTasks] K2B 일일 검증 등록 실패:', error?.message || String(error));
            return null;
        }
    }

    /** 17:00 KST: enqueue once only; the Windows Realtime worker performs it. */
    public async enqueueDailyNationalSupportChecks(): Promise<void> {
        const admin = createAdminClient();
        const date = getKSTDateString();
        const { data: targets, error } = await admin.from('measurement_target_business')
            .select('id, code, year, period, industrial_accident_number, commencement_number, representative_name, manager_name, manager_mobile, national_support_status')
            .is('national_support_status', null)
            .not('code', 'is', null)
            .not('year', 'is', null)
            .not('period', 'is', null);
        if (error) throw error;
        for (const target of targets || []) {
            if (String(target.period).includes('(수시)')) continue;
            if (!target.industrial_accident_number || !target.commencement_number || !target.representative_name) continue;
            if (await hasMeasurementJournalForTarget(admin, target)) continue;
            await enqueueAutomationJob(admin, {
                jobType: 'NATIONAL_SUPPORT',
                idempotencyKey: nationalSupportIdempotencyKey('scheduled_lookup', String(target.code), target.year, target.period, date),
                targetKey: `national-support:${target.id}`,
                requestPayload: {
                    target_id: target.id, code: target.code, year: target.year, period: target.period,
                    sanjae: target.industrial_accident_number, commencement: target.commencement_number,
                    representative: target.representative_name, contact_name: target.manager_name || '', contact_phone: target.manager_mobile || '',
                    mode: hasNationalSupportApplicationInformation({
                      industrial_accident_number: target.industrial_accident_number,
                      commencement_number: target.commencement_number,
                      representative_name: target.representative_name,
                      manager_name: target.manager_name,
                      manager_mobile: target.manager_mobile,
                    }) ? 'apply_if_missing' : 'lookup_only', scheduled_at: date,
                },
            });
        }
    }

    /**
     * MES 다운로드 파이썬 스크립트 실행
     */
    public async runMesDownloadScript(isFinalCheck: boolean = false): Promise<boolean> {
        try {
            const supabase = createAdminClient();
            const kstDate = getKSTDateString();
            const slot = isFinalCheck ? '14:00' : new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
            const job = await enqueueAutomationJob(supabase, {
                jobType: 'MES_SYNC',
                idempotencyKey: mesScheduledIdempotencyKey(slot, kstDate),
                targetKey: `mes:scheduled:${slot}`,
                requestPayload: { trigger: 'scheduled', slot, final_check: isFinalCheck },
            });
            console.log(`[BackgroundTasks] MES 자동 작업 등록 id=${job.id} slot=${slot}`);
            return true;
        } catch (error: any) {
            const message = error?.message || String(error);
            console.error('[BackgroundTasks] MES 자동 다운로드 요청 실패:', message);
            this.mesSyncStatus = 'error';
            this.mesSyncError = message;
            return false;
        }
    }

}
