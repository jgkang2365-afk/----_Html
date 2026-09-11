import { BounceChecker } from '../email/bounce-checker';
import { backupDatabase } from '../../scripts/backup-db';
import { createAdminClient } from '../supabase/admin';
import { createClient } from '../supabase/server';
import { getKSTDateString, getKSTISOString } from '../utils/date-utils';
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
            .select("code, business_name, year, period")
            .eq("measurement_date", kstToday);
            
        if (surveyError) {
            console.error("[BackgroundTasks] 예비조사 목록 조회 실패:", surveyError.message);
            return;
        }
        
        if (!todaySurveys || todaySurveys.length === 0) {
            console.log("[BackgroundTasks] 오늘 예정된 예비조사 업체 일정이 없습니다.");
            return;
        }
        
        const validTodaySurveys = todaySurveys.filter(survey => {
            const rawYear = survey.year;
            const year = Number(rawYear);
            const period = String(survey.period || "").trim();
            return rawYear !== null
                && rawYear !== undefined
                && String(rawYear).trim() !== ""
                && Number.isInteger(year)
                && year > 0
                && period !== "";
        });

        if (validTodaySurveys.length < todaySurveys.length) {
            console.warn(
                `[BackgroundTasks] 연도/주기 정보가 없는 오늘 예비조사 ${todaySurveys.length - validTodaySurveys.length}건은 오탐 방지를 위해 MES 미등록 점검에서 제외합니다.`
            );
        }

        if (validTodaySurveys.length === 0) {
            console.error("[BackgroundTasks] 연도와 주기가 확인되는 오늘 예비조사가 없어 MES 등록 여부를 확인할 수 없습니다.");
            return;
        }

        const surveyYears = [...new Set(
            validTodaySurveys.map(survey => Number(survey.year))
        )];
        const surveyPeriods = [...new Set(
            validTodaySurveys.map(survey => String(survey.period).trim())
        )];

        // 2. 오늘 예비조사와 같은 연도/주기의 측정대상 사업장을 모두 조회
        // Supabase 기본 조회 한도(통상 1,000건)로 기존 등록분이 누락되지 않도록 페이지 단위로 조회한다.
        const mbList: Array<{
            code: string | null;
            business_name: string | null;
            year: number | string | null;
            period: string | null;
        }> = [];
        const pageSize = 1000;

        for (let from = 0; ; from += pageSize) {
            const { data: mbRows, error: mbError } = await supabase
                .from("measurement_business")
                .select("code, business_name, year, period")
                .in("year", surveyYears)
                .in("period", surveyPeriods)
                .order("year", { ascending: true })
                .order("period", { ascending: true })
                .order("code", { ascending: true })
                .range(from, from + pageSize - 1);

            if (mbError) {
                console.error("[BackgroundTasks] 측정대상 사업장 목록 조회 실패:", mbError.message);
                return;
            }

            const pageRows = mbRows || [];
            mbList.push(...pageRows);
            if (pageRows.length < pageSize) break;
        }

        const unregisteredNames: string[] = [];
        
        for (const survey of validTodaySurveys) {
            const sCode = String(survey.code || "").trim();
            const sName = String(survey.business_name || "").trim();
            const sYear = Number(survey.year);
            const sPeriod = String(survey.period || "").trim();
            
            // 매칭 비교 (3단계 알고리즘 대조)
            const isRegistered = mbList.some(row => {
                const rCode = String(row.code || "").trim();
                const rName = String(row.business_name || "").trim();
                const rYear = Number(row.year);
                const rPeriod = String(row.period || "").trim();

                // 해당 예비조사의 연도/주기에 등록된 MES 자료만 인정
                if (sYear !== rYear || sPeriod !== rPeriod) return false;
                
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
