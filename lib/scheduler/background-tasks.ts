import { BounceChecker } from '../email/bounce-checker';
import { backupDatabase } from '../../scripts/backup-db';
import { createAdminClient } from '../supabase/admin';
import { getKSTDateString } from '../utils/date-utils';
import { K2B_VERIFY_SCHEDULE } from '../constants/k2b-verification';
import { buildK2BSyncRange, K2B_SYNC_OVERLAP_DAYS } from '../automation/k2b-original-sync';
import { enqueueAutomationJob, mesScheduledIdempotencyKey, nationalSupportIdempotencyKey } from '../automation/jobs';
import { forEachAscendingIdPage } from './id-pages';
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
    private postSyncTimer: ReturnType<typeof setTimeout> | null = null;
    private postSyncWakeAt: number | null = null;

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
            this.startMesPostSyncWake();
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
            await BackgroundTasks.getInstance().runMesDownloadScript('11:30');
        }, KST_CRON_OPTIONS);

        cron.schedule('0 12 * * *', async () => {
            console.log("[BackgroundTasks] 12:00 MES 자동 다운로드 작업을 기동합니다...");
            await BackgroundTasks.getInstance().runMesDownloadScript('12:00');
        }, KST_CRON_OPTIONS);

        cron.schedule('0 14 * * *', async () => {
            console.log("[BackgroundTasks] 14:00 최종 MES 자동 다운로드 및 연동 여부 점검을 기동합니다...");
            await BackgroundTasks.getInstance().runMesDownloadScript('14:00');
        }, KST_CRON_OPTIONS);

        // Post-sync actions wake on their own durable signal/available_at.

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

    private startMesPostSyncWake(): void {
        const admin = createAdminClient();
        admin.channel('local-mes-post-sync-checks')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'automation_job_signals', filter: 'job_type=eq.MES_POST_SYNC_CHECK' }, payload => {
                const signal = payload.new as { status?: string; available_at?: string } | null;
                if (signal?.status === 'PENDING' && signal.available_at) {
                    this.scheduleMesPostSyncWake(new Date(signal.available_at));
                }
            })
            .subscribe(status => { if (status === 'SUBSCRIBED') void this.drainMesPostSyncChecks(); });
    }

    private scheduleMesPostSyncWake(at: Date): void {
        const time = at.getTime();
        if (!Number.isFinite(time)) return;
        if (this.postSyncWakeAt !== null && this.postSyncWakeAt <= time) return;
        if (this.postSyncTimer) clearTimeout(this.postSyncTimer);
        this.postSyncWakeAt = time;
        this.postSyncTimer = setTimeout(() => {
            this.postSyncTimer = null;
            this.postSyncWakeAt = null;
            void this.drainMesPostSyncChecks();
        }, Math.max(0, Math.min(time - Date.now(), 2_147_483_647)));
    }

    private async drainMesPostSyncChecks(): Promise<void> {
        try {
            const { error } = await createAdminClient().rpc('process_mes_post_sync_checks', { p_limit: 100 });
            if (error) throw error;
            const { data, error: pendingError } = await createAdminClient().from('automation_jobs')
                .select('available_at').eq('job_type', 'MES_POST_SYNC_CHECK').eq('status', 'PENDING')
                .order('available_at', { ascending: true }).limit(1);
            if (pendingError) throw pendingError;
            if (data?.[0]?.available_at) this.scheduleMesPostSyncWake(new Date(data[0].available_at));
        } catch (error) {
            console.error('[BackgroundTasks] MES 후속 점검 처리 실패:', error);
        }
    }

    /** 17:00 KST: enqueue once only; the Windows Realtime worker performs it. */
    public async enqueueDailyNationalSupportChecks(): Promise<void> {
        const admin = createAdminClient();
        const date = getKSTDateString();
        const pageSize = 500;
        let enqueued = 0;
        let failed = 0;
        await forEachAscendingIdPage(pageSize, async (lastId, limit) => {
          const { data, error } = await admin.from('measurement_target_business')
              .select('id, code, year, period, industrial_accident_number, commencement_number, representative_name, manager_name, manager_mobile, national_support_status')
              .is('national_support_status', null)
              .not('code', 'is', null)
              .not('year', 'is', null)
              .not('period', 'is', null)
              .gt('id', lastId).order('id', { ascending: true }).limit(limit);
          if (error) throw error;
          return data || [];
        }, async (target) => {
            if (String(target.period).includes('(수시)')) return;
            if (!target.industrial_accident_number || !target.commencement_number || !target.representative_name) return;
            if (await hasMeasurementJournalForTarget(admin, target)) return;
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
            enqueued += 1;
        }, (target, error) => {
            failed += 1;
            console.error(`[BackgroundTasks] 건강디딤돌 예약 실패 target=${target.id}`, error);
        });
        console.log(`[BackgroundTasks] 건강디딤돌 예약 완료 enqueued=${enqueued} failed=${failed}`);
    }

    /**
     * MES 다운로드 파이썬 스크립트 실행
     */
    public async runMesDownloadScript(slot: '11:30' | '12:00' | '14:00'): Promise<boolean> {
        try {
            const supabase = createAdminClient();
            const kstDate = getKSTDateString();
            const isFinalCheck = slot === '14:00';
            const job = await enqueueAutomationJob(supabase, {
                jobType: 'MES_SYNC',
                idempotencyKey: mesScheduledIdempotencyKey(slot, kstDate),
                targetKey: `mes:scheduled:${slot}`,
                requestPayload: { trigger: 'scheduled', slot, final_check: isFinalCheck, scheduled_date_kst: kstDate },
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
