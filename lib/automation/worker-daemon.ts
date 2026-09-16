import { createClient } from '../supabase/server';
import { EmailService } from '../email/email-service';
import { K2BService } from './k2b-service';
import { querySubmissionResultsForRange, withK2BReadOnlySession } from './k2b-verification-service';
import { K2BJournalPersistenceError, requireK2BJournalPersistence } from './k2b-upload-persistence';
import { hasK2BReceiptError, journalStatusForK2BReconciliation, reconcileK2BSubmissionResults, selectChangedK2BPostUploadUpdate, selectChangedK2BReconciliationUpdate, selectK2BStaleUpdates, shouldReflectActualK2BStatus, verificationFailureState } from '../k2b-verification';
import { decideK2BCalendarSync } from './k2b-calendar-sync-policy';
import { buildGeneralK2BVerificationRange, buildK2BStaleCutoff, buildK2BSyncRange, filterK2BObservedJournalCandidates, inclusiveK2BDates, resolveK2BJournalScope, shouldSweepK2BStale, type K2BOriginalReceipt, type K2BSyncTrigger } from './k2b-original-sync';
import { createAdminClient } from '../supabase/admin';
import os from 'node:os';
import {
    getReportProcessingPeriodForDate,
    REPORT_PROCESSING_EXCLUDED_BUSINESS_NAME_PATTERN,
    selectReportProcessingCodes,
} from '../report-processing/scope';
import { findReportFiles } from '../utils/findReportFiles';
import { getKSTISOString, getKSTDateString } from '../utils/date-utils';
import { requestK2BCalendarSync } from "./k2b-calendar-sync-client";
import { beginK2BPostUploadResult, finalizeK2BPostUploadResult, markK2BGridConfirmationFailure, type K2BPostUploadResult } from "./k2b-post-upload-result";
import { processNationalSupportJob } from "./national-support-worker";
import { enqueueAutomationJob } from "./jobs";
import {
    NATIONAL_SUPPORT_STALE_THRESHOLD_MS,
    NATIONAL_SUPPORT_STALE_WATCHDOG_MS,
    WORKER_ACTIVE_POLL_MS,
    type WorkerPollOutcome,
    nextWorkerPollingState,
} from "./worker-polling-policy";

export type K2BVerifyTrigger = 'manual' | 'scheduled' | 'unknown';

/**
 * K2B 검증 작업의 실행 계기는 payload에 명시된 값만 신뢰한다.
 * 요청자 유무는 자격 증명 조회에만 사용하며 실행 계기를 보정하지 않는다.
 */
export function resolveK2BVerifyTrigger(payload: unknown): K2BVerifyTrigger {
    const trigger = typeof payload === 'object' && payload !== null
        ? (payload as { trigger?: unknown }).trigger
        : undefined;

    if (trigger === 'manual') return 'manual';
    if (trigger === 'scheduled') return 'scheduled';
    return 'unknown';
}

/**
 * 백그라운드 작업기 데몬 (Worker Daemon)
 * 로컬 서버 환경에서만 가동되며, background_jobs 테이블을 감시해
 * 이메일, K2B, 건강디딤돌 조회 작업을 비동기 처리합니다.
 */
export class WorkerDaemon {
    private static instance: WorkerDaemon;
    private pollingTimer: NodeJS.Timeout | null = null;
    private staleWatchdogInterval: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    private isProcessing: boolean = false;
    private isRecoveringStaleJobs: boolean = false;
    private idlePollCount: number = 0;
    private currentK2BService: K2BService | null = null;
    private currentJobId: string | null = null;

    private constructor() {
        // 프로세스 종료 시 Graceful Shutdown을 위한 이벤트 등록
        if (typeof process !== 'undefined') {
            process.on('SIGINT', () => this.handleShutdown('SIGINT'));
            process.on('SIGTERM', () => this.handleShutdown('SIGTERM'));
        }
    }

    public static getInstance(): WorkerDaemon {
        // Next.js 개발 중 핫 리로드(Hot Reload) 시 인스턴스 중복 생성 방지를 위한 global 객체 사용
        const globalRef = global as any;
        if (!globalRef.workerDaemonInstance) {
            globalRef.workerDaemonInstance = new WorkerDaemon();
        }
        return globalRef.workerDaemonInstance;
    }

    /**
     * 워커 시작
     */
    public start() {
        // 로컬 서버 환경 변수가 없으면 워커를 시작하지 않음 (Vercel 배포 환경 오동작 가드)
        if (!process.env.REPORT_STORAGE_ROOT) {
            console.log("[WorkerDaemon] REPORT_STORAGE_ROOT 환경 변수가 없습니다. 로컬 서버가 아니므로 워커를 구동하지 않습니다.");
            return;
        }

        if (this.isRunning) {
            console.log("[WorkerDaemon] 이미 워커가 실행 중입니다.");
            return;
        }

        console.log(
            "[WorkerDaemon] background_jobs 전용 작업기를 시작합니다. " +
            "(문서 생성 Worker와 별도 실행)"
        );
        this.isRunning = true;
        this.idlePollCount = 0;
        this.scheduleNextPoll(WORKER_ACTIVE_POLL_MS);
        this.staleWatchdogInterval = setInterval(
            () => void this.runStaleNationalSupportWatchdog(),
            NATIONAL_SUPPORT_STALE_WATCHDOG_MS,
        );
    }

    /**
     * 워커 정지
     */
    public stop() {
        const wasRunning = this.isRunning;
        this.isRunning = false;

        if (this.pollingTimer) {
            clearTimeout(this.pollingTimer);
            this.pollingTimer = null;
        }
        if (this.staleWatchdogInterval) {
            clearInterval(this.staleWatchdogInterval);
            this.staleWatchdogInterval = null;
        }

        if (wasRunning) {
            console.log("[WorkerDaemon] 백그라운드 작업기(Worker Daemon)를 정지했습니다.");
        }
    }

    private scheduleNextPoll(delayMs: number) {
        if (!this.isRunning) return;

        this.pollingTimer = setTimeout(async () => {
            this.pollingTimer = null;
            const outcome = await this.poll();
            const nextState = nextWorkerPollingState(
                this.idlePollCount,
                outcome,
            );
            this.idlePollCount = nextState.idlePollCount;
            this.scheduleNextPoll(nextState.delayMs);
        }, delayMs);
    }

    /**
     * 큐 폴링 함수
     */
    private async poll(): Promise<WorkerPollOutcome> {
        // 현재 작업을 처리 중이면 중복 폴링 패스
        if (this.isProcessing) return "activity";

        this.isProcessing = true;

        try {
            const supabase = await createClient();

            // PENDING 상태인 가장 오래된 작업 1개 획득
            const { data: jobs, error } = await supabase
                .from('background_jobs')
                .select('*')
                .eq('status', 'pending')
                .lte('available_at', new Date().toISOString())
                .order('available_at', { ascending: true })
                .order('created_at', { ascending: true })
                .limit(1);

            if (error) throw error;
            if (!jobs || jobs.length === 0) {
                return "idle";
            }

            const job = jobs[0];

            // 낙관적 락(Optimistic Lock): 상태를 'processing'으로 업데이트하여 선점 시도
            const { data: updatedJobs, error: lockError } = await supabase
                .from('background_jobs')
                .update({ 
                    status: 'processing',
                    started_at: getKSTISOString(),
                    finished_at: null,
                    updated_at: getKSTISOString()
                })
                .eq('id', job.id)
                .eq('status', 'pending')
                .select();

            if (lockError) throw lockError;

            // 이미 다른 워커가 가져갔거나 낙관적 락 획득 실패 시 다음 루프로 패스
            if (!updatedJobs || updatedJobs.length === 0) {
                console.log(`[WorkerDaemon] 작업 선점 실패 (이미 다른 프로세스가 처리 중): ${job.id}`);
                return "activity";
            }

            console.log(`[WorkerDaemon] 작업 선점 성공: ID = ${job.id}, Type = ${job.job_type}`);
            this.currentJobId = job.id;

            // 실제 작업 처리 분기
            if (job.job_type === 'email') {
                await this.processEmailJob(job);
            } else if (job.job_type === 'k2b') {
                await this.processK2BJob(job);
            } else if (job.job_type === 'k2b_verify') {
                await this.processK2BVerifyJob(job);
            } else if (job.job_type === 'k2b_original_sync') {
                await this.processK2BOriginalSyncJob(job);
            } else if (job.job_type === 'national_support') {
                await this.processNationalSupportJob(job);
            } else {
                throw new Error(`알 수 없는 작업 유형: ${job.job_type}`);
            }

            return "activity";

        } catch (e: any) {
            console.error("[WorkerDaemon] 폴링 루프 오류:", e.message);
            return "error";
        } finally {
            this.isProcessing = false;
            this.currentJobId = null;
        }
    }

    private async runStaleNationalSupportWatchdog() {
        if (this.isRecoveringStaleJobs) return;

        this.isRecoveringStaleJobs = true;
        try {
            const supabase = await createClient();
            await this.recoverStaleNationalSupportJobs(supabase);
        } catch (e: any) {
            console.error('[WorkerDaemon] 건강디딤돌 watchdog 오류:', e.message);
        } finally {
            this.isRecoveringStaleJobs = false;
        }
    }

    private async recoverStaleNationalSupportJobs(supabase: any) {
        const staleThreshold = new Date(Date.now() - NATIONAL_SUPPORT_STALE_THRESHOLD_MS).toISOString();
        const { data: staleJobs, error } = await supabase
            .from('background_jobs')
            .select('id, payload, updated_at')
            .eq('job_type', 'national_support')
            .eq('status', 'processing')
            .lt('updated_at', staleThreshold)
            .limit(5);

        if (error) {
            console.error('[WorkerDaemon] 건강디딤돌 장기 processing 작업 확인 실패:', error.message);
            return;
        }

        if (!staleJobs || staleJobs.length === 0) return;

        for (const job of staleJobs) {
            const message = '건강디딤돌 조회가 장시간 종료되지 않아 자동 실패 처리되었습니다. 다시 조회를 눌러 재시도해주세요.';
            await supabase
                .from('background_jobs')
                .update({
                    status: 'failed',
                    error_message: message,
                    updated_at: getKSTISOString()
                })
                .eq('id', job.id)
                .eq('status', 'processing');

            const targetId = job.payload?.target_id;
            if (targetId) {
                await supabase
                    .from('measurement_target_business')
                    .update({
                        sync_status: '실패',
                        sync_error_message: message,
                        updated_at: getKSTISOString()
                    })
                    .eq('id', targetId)
                    .in('sync_status', ['신청중', '조회중']);
            }

            console.warn(`[WorkerDaemon] 장기 processing 건강디딤돌 작업 자동 실패 처리: ${job.id}`);
        }
    }

    private async isCancelRequested(jobId: string) {
        const supabase = await createClient();
        const { data } = await supabase
            .from('background_jobs')
            .select('status')
            .eq('id', jobId)
            .maybeSingle();
        return data?.status === 'cancel_requested';
    }

    private async cancelJob(jobId: string, requestUser: any, label: string) {
        await this.updateJobStatus(jobId, 'cancelled', '사용자가 중단 요청을 실행했습니다.');
        await this.createInAppNotification(requestUser?.id, 'warning', `[${label} 중단] 사용자 요청으로 남은 작업을 중단했습니다.`);
    }

    private async processNationalSupportJob(job: any) {
        try {
            const result = await processNationalSupportJob({
                ...job.payload,
                attempt_count: job.attempt_count ?? job.payload?.attempt_count ?? 0,
            });
            await this.updateJobStatus(job.id, 'success');
            if (result.followUp) {
                const supabase = await createClient();
                const payload = result.followUp.payload;
                const { data: journal } = await supabase.from('measurement_journal')
                    .select('code').eq('code', payload.code).eq('measurement_year', Number(payload.year))
                    .eq('measurement_period', payload.period).maybeSingle();
                if (!journal) await enqueueAutomationJob(supabase, {
                    jobType: 'NATIONAL_SUPPORT',
                    idempotencyKey: `national-support:legacy-final:${job.id}:${payload.attempt_count || 0}`,
                    targetKey: `national-support:${payload.target_id}`,
                    requestPayload: payload,
                    availableAt: result.followUp.availableAt.toISOString(),
                });
            }
        } catch (error: any) {
            await this.updateJobStatus(
                job.id,
                'failed',
                error?.message || '건강디딤돌 조회 작업 실패'
            );
        }
    }

    /**
     * 이메일 합산 발송 작업 처리
     */
    private async processEmailJob(job: any) {
        const supabase = await createClient();
        const payload = job.payload || {};
        const targets = payload.targets || [];
        const requestUser = payload.requestUser || null; // 요청한 사용자 정보

        if (targets.length === 0) {
            await this.updateJobStatus(job.id, 'failed', '발송 대상 업체 정보(payload)가 비어있습니다.');
            return;
        }

        const emailService = new EmailService();
        const results = [];
        let successCount = 0;
        let failCount = 0;

        try {
            for (const target of targets) {
                if (await this.isCancelRequested(job.id)) {
                    await this.cancelJob(job.id, requestUser, '이메일 전송');
                    return;
                }
                const { business_name, manager_email, reports } = target;

                if (!reports || reports.length === 0) {
                    results.push({ companyName: business_name, success: false, error: '발송할 보고서 정보가 없습니다.' });
                    failCount++;
                    continue;
                }

                try {
                    const allAttachments: { filename: string; path: string }[] = [];
                    const processedReports: any[] = [];

                    // 1. 로컬 Z드라이브 파일 조회
                    for (const r of reports) {
                        const rowFiles = findReportFiles({ 
                            year: String(r.year), 
                            semester: r.period, 
                            companyName: business_name 
                        });

                        if (rowFiles.report) {
                            allAttachments.push({ filename: rowFiles.report.filename, path: rowFiles.report.path });
                            if (rowFiles.invoice) {
                                allAttachments.push({ filename: rowFiles.invoice.filename, path: rowFiles.invoice.path });
                            }
                            processedReports.push(r);
                        } else {
                            console.warn(`[WorkerDaemon File Not Found] ${business_name} ${r.year}-${r.period}`);
                        }
                    }

                    if (allAttachments.length === 0) {
                        results.push({ 
                            companyName: business_name, 
                            success: false, 
                            error: '첨부할 가용한 로컬 보고서 파일(PDF)을 공유 폴더(Z:\\)에서 찾을 수 없습니다.' 
                        });
                        failCount++;
                        continue;
                    }

                    // 2. 이메일 실제 전송
                    await emailService.sendReportEmail({
                        to: manager_email,
                        companyName: business_name,
                        reports: processedReports.map(r => ({ year: String(r.year), period: r.period })),
                        attachments: allAttachments
                    });

                    // 3. 비즈니스 테이블 DB 상태 업데이트 (이메일 발송 완료 처리)
                    const nowISO = getKSTISOString();
                    for (const r of processedReports) {
                        // measurement_business 업데이트
                        await supabase
                            .from('measurement_business')
                            .update({
                                is_email_sent: true,
                                last_email_sent_at: nowISO,
                            })
                            .eq('code', r.code)
                            .eq('year', r.year)
                            .eq('period', r.period);

                        // measurement_journal 업데이트
                        await supabase
                            .from('measurement_journal')
                            .update({
                                is_email_sent: true,
                                last_email_sent_at: nowISO,
                            })
                            .eq('code', r.code)
                            .eq('measurement_year', r.year)
                            .eq('measurement_period', r.period);
                    }

                    results.push({ companyName: business_name, success: true, count: processedReports.length });
                    successCount++;
                } catch (err: any) {
                    console.error(`[WorkerDaemon Email Fail] ${business_name}:`, err);
                    results.push({
                        companyName: business_name,
                        success: false,
                        error: err.message || '알 수 없는 이메일 발송 오류'
                    });
                    failCount++;
                }
            }

            // 최종 Job 상태 결정
            if (failCount === 0) {
                await this.updateJobStatus(job.id, 'success');
                // 요청 성공 알림 생성
                await this.createInAppNotification(
                    requestUser?.id, 
                    'info', 
                    `[이메일 전송 완료] ${targets[0]?.business_name}${targets.length > 1 ? ` 외 ${targets.length - 1}곳` : ''}의 보고서 이메일 발송이 성공했습니다.`
                );
            } else if (successCount > 0) {
                // 부분 성공
                await this.updateJobStatus(job.id, 'success', `일부 전송 완료: ${successCount}건 성공, ${failCount}건 실패`);
                await this.createInAppNotification(
                    requestUser?.id, 
                    'warning', 
                    `[이메일 일부 전송] ${successCount}건 성공, ${failCount}건 실패하였습니다. 상단 알림에서 실패 원인을 확인해 주세요.`
                );
                // 관리자들에게 실패 내역 알림
                const failDetails = results.filter(r => !r.success).map(r => `${r.companyName}(사유: ${r.error})`).join(', ');
                await this.notifyAllManagers('error', `[이메일 발송 실패] 일부 발송에 실패했습니다. 실패 업체: ${failDetails}`);
            } else {
                // 완전 실패
                const failDetails = targets.map((t: any) => t.business_name).join(', ');
                const errorReason = results[0]?.error || '가용한 파일 없음';
                await this.updateJobStatus(job.id, 'failed', `발송 실패: ${errorReason}`);
                
                const errorMsg = `[이메일 발송 실패] ${failDetails} 전송 실패. 사유: ${errorReason}`;
                await this.createInAppNotification(requestUser?.id, 'error', errorMsg);
                await this.notifyAllManagers('error', errorMsg);
            }

        } catch (error: any) {
            console.error("[WorkerDaemon] 이메일 잡 처리 실패:", error);
            const errorMsg = `[이메일 발송 오류] 백그라운드 처리 중 오류 발생: ${error.message}`;
            await this.updateJobStatus(job.id, 'failed', error.message || '이메일 발송 중 내부 치명적 오류 발생');
            await this.createInAppNotification(requestUser?.id, 'error', errorMsg);
            await this.notifyAllManagers('error', errorMsg);
        }
    }

    /** K2B 원본 동기화: 한 range의 모든 receipt 저장과 일지 연계가 성공한 scheduled 작업만 cursor를 전진한다. */
    private async processK2BOriginalSyncJob(job: any) {
        const admin = createAdminClient();
        const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
        const trigger = payload.trigger as K2BSyncTrigger;
        const executionResult: Record<string, any> = {
            mode: 'original_sync_v0_2', trigger, host: os.hostname(), sourceHost: os.hostname(), fromDate: null, toDate: null, requestedRange: null, queriedRange: null,
            cursorBefore: null, cursorAfter: null, cursorAdvanced: false, remoteReadState: 'not_started',
            cursorEligible: trigger === 'scheduled', queriedDates: [], remoteRowCount: 0, dateResults: [],
            rawReceiptPersistence: { attempted: 0, saved: 0, failed: 0, insertedCount: 0, updatedCount: 0, unchangedCount: 0, fallbackKeyCount: 0 }, journalVerification: { matched: 0, saved: 0, stale: 0 },
            remoteK2BReadAttempted: false, remoteK2BReadExecuted: false, databaseSaveCompleted: false, uploadExecuted: false, failureStage: null,
        };
        const fail = async (message: string, stage: string) => {
            executionResult.failureStage = stage;
            await this.updateK2BExecutionResult(job.id, executionResult);
            await this.updateJobStatus(job.id, 'failed', message);
        };
        if (trigger !== 'manual' && trigger !== 'scheduled') return fail('K2B 원본 동기화 trigger가 manual/scheduled로 명시되지 않았습니다.', 'validate_trigger');
        if (trigger === 'manual' && (payload.requestedBy == null || !payload.fromDate || !payload.toDate)) return fail('수동 K2B 원본 동기화에는 requestedBy와 from/to가 필요합니다.', 'validate_manual');
        if (trigger === 'scheduled' && payload.requestedBy != null) return fail('scheduled K2B 원본 동기화에는 requestedBy를 넣을 수 없습니다.', 'validate_scheduled');
        const stateResult = await admin.from('k2b_sync_state').select('last_successful_through_date').eq('state_key', 'default').maybeSingle();
        if (stateResult.error) return fail(stateResult.error.message, 'load_cursor');
        executionResult.cursorBefore = stateResult.data?.last_successful_through_date ?? null;
        let range: { fromDate: string; toDate: string };
        try {
            range = buildK2BSyncRange({ trigger, today: getKSTDateString(), fromDate: payload.fromDate, toDate: payload.toDate, lastSuccessfulThroughDate: stateResult.data?.last_successful_through_date ?? null });
        } catch (error: any) { return fail(error?.message || 'K2B 원본 동기화 범위가 올바르지 않습니다.', 'build_range'); }
        executionResult.requestedRange = range;
        executionResult.fromDate = range.fromDate;
        executionResult.toDate = range.toDate;
        await this.updateK2BExecutionResult(job.id, executionResult);
        try {
            executionResult.remoteReadState = 'processing';
            executionResult.remoteK2BReadAttempted = true;
            await this.updateK2BExecutionResult(job.id, executionResult);
            // 하나의 로그인/읽기전용 세션에서 range query를 정확히 한 번 실행한다.
            const receipts = await withK2BReadOnlySession(async (k2b) => {
                try {
                  const grid = await k2b.querySubmissionResultsForRange(range.fromDate, range.toDate);
                  executionResult.remoteK2BReadExecuted = true;
                  executionResult.queriedDates = [range.fromDate, range.toDate];
                  executionResult.remoteRowCount = grid.rows.length;
                  executionResult.remoteExpectedRowCount = grid.expectedRowCount;
                  executionResult.gridReadMethod = grid.readMethod;
                  executionResult.gridReadComplete = grid.completeness;
                  executionResult.dateResults = [{ fromDate: range.fromDate, toDate: range.toDate, outcome: grid.outcome, rowCount: grid.rows.length }];
                  if (grid.completeness !== 'COMPLETE') throw new Error('K2B_GRID_READ_INCOMPLETE');
                  return grid.rows;
                } catch (error: any) {
                  const message = error?.message || String(error);
                  executionResult.failureStage = message.includes('K2B_GRID_SCHEMA_MISMATCH') ? 'K2B_GRID_SCHEMA_MISMATCH' : /login|로그인|K2B_ID|K2B_PW/i.test(message) ? 'LOGIN_FAILED' : 'QUERY_FAILED';
                  throw new Error(`${executionResult.failureStage}:${message}`);
                }
            });
            executionResult.remoteReadState = receipts.length === 0 ? 'success_empty' : 'completed';
            executionResult.queriedRange = range;
            // 1) 원본 receipt를 전부 보존한다. journal 상태는 이 루프에서 건드리지 않는다.
            for (const receipt of receipts) {
                executionResult.rawReceiptPersistence.attempted += 1;
                if (receipt.identityFallback) executionResult.rawReceiptPersistence.fallbackKeyCount += 1;
                const { data: persistence, error } = await admin.rpc('upsert_k2b_file_receipt', { p_receipt: receipt, p_job_id: job.id });
                if (error) throw error;
                executionResult.rawReceiptPersistence.saved += 1;
                const disposition = typeof persistence === 'object' && persistence ? (persistence as any).disposition : null;
                if (disposition === 'inserted') executionResult.rawReceiptPersistence.insertedCount += 1;
                else if (disposition === 'updated') executionResult.rawReceiptPersistence.updatedCount += 1;
                else if (disposition === 'unchanged') executionResult.rawReceiptPersistence.unchangedCount += 1;
            }
            // 2) receipt의 사업년도/반기 scope로 일지를 한 번에 가져온 뒤 canonical 4-key로
            // 결합한다. 과거 정상 접수일이 range 밖이어도 최신 반송/재접수를 놓치지 않는다.
            const journalFields = 'id, code, business_name, industrial_accident_number, commencement_number, measurement_year, measurement_period, k2b_status, k2b_send_date, k2b_verified_status, k2b_verified_at, k2b_verified_send_date, k2b_verified_result_date, k2b_verified_remote_status, k2b_consistency_status, k2b_consistency_note, k2b_verification_error, k2b_verification_attempted_at';
            const scopes = receipts.map(resolveK2BJournalScope);
            const years = Array.from(new Set(scopes.map((scope) => scope.measurementYear)));
            const periods = Array.from(new Set(scopes.map((scope) => scope.measurementPeriod)));
            const journalResult = years.length > 0
                ? await admin.from('measurement_journal').select(journalFields).in('measurement_year', years).in('measurement_period', periods)
                : { data: [], error: null };
            const { data: journals, error: journalError } = journalResult;
            if (journalError) throw journalError;
            // bulk year/period 조회 결과는 넓은 Cartesian 후보일 수 있다. 이번 COMPLETE Grid에서
            // 실제 관측한 canonical 4-key에 정확히 속한 일지 외에는 어떤 상태도 바꾸지 않는다.
            const observedJournals = filterK2BObservedJournalCandidates((journals || []).map((journal: any) => ({
                ...journal,
                industrialAccidentNumber: journal.industrial_accident_number,
                commencementNumber: journal.commencement_number,
                measurementYear: journal.measurement_year,
                measurementPeriod: journal.measurement_period,
            })), receipts);
            const reconciled = reconcileK2BSubmissionResults(observedJournals.map((journal: any) => ({
                journalId: journal.id, code: String(journal.code ?? ''), businessName: String(journal.business_name ?? ''),
                industrialAccidentNumber: journal.industrial_accident_number, commencementNumber: journal.commencement_number,
                measurementYear: journal.measurement_year, measurementPeriod: journal.measurement_period,
                resultDate: journal.k2b_send_date, previousVerifiedStatus: journal.k2b_verified_status,
                previousVerifiedAt: journal.k2b_verified_at, internalK2BStatus: journal.k2b_status,
                internalK2BSendDate: journal.k2b_send_date,
            })), receipts.map((receipt) => ({
                managementNumber: receipt.managementNumber, commencementNumber: receipt.commencementNumber,
                submissionDate: receipt.actualSubmissionDate, status: receipt.status,
                errorViewAvailable: receipt.errorViewAvailable, errorDetail: receipt.errorDetail,
                submissionNumber: receipt.submissionNumber, identityConflict: receipt.identityConflict,
                businessYear: receipt.businessYear, half: receipt.half,
            })), { completeness: 'COMPLETE' });
            for (let index = 0; index < reconciled.length; index += 1) {
                const item = reconciled[index];
                const journal = observedJournals[index] as any;
                const attemptedAt = getKSTISOString();
                if (item.match) executionResult.journalVerification.matched += 1;
                const update = selectChangedK2BReconciliationUpdate(item, journal, attemptedAt);
                if (update) {
                    const { error: updateError } = await admin.from('measurement_journal').update(update).eq('id', journal.id);
                    if (updateError) throw updateError;
                    executionResult.journalVerification.saved += 1;
                }
            }
            // STALE sweep은 scheduled에만 실행한다. cursor/manual range가 아닌 KST 7일
            // canonical cutoff를 사용하고, 기존 실제 관측 필드는 update에 포함하지 않는다.
            if (shouldSweepK2BStale(trigger)) {
                const staleCutoff = buildK2BStaleCutoff(getKSTDateString());
                const { data: staleCandidates, error: staleCandidatesError } = await admin.from('measurement_journal')
                    .select('id, k2b_verified_status, k2b_consistency_status, k2b_consistency_note')
                    .lt('k2b_send_date', staleCutoff)
                    .or('k2b_verified_status.is.null,k2b_verified_status.neq.GREEN');
                if (staleCandidatesError) throw staleCandidatesError;
                for (const { id, update: staleUpdate } of selectK2BStaleUpdates(staleCandidates || [])) {
                    const { error: staleError } = await admin.from('measurement_journal')
                        .update(staleUpdate)
                        .eq('id', id);
                    if (staleError) throw staleError;
                    executionResult.journalVerification.stale += 1;
                }
            }
            executionResult.databaseSaveCompleted = executionResult.rawReceiptPersistence.saved === executionResult.rawReceiptPersistence.attempted;
            // 수동은 cursor를 절대 전진하지 않는다. scheduled는 range 전체가 성공한 후에만 전진한다.
            if (trigger === 'scheduled' && executionResult.databaseSaveCompleted) {
                const { error: cursorError } = await admin.rpc('advance_k2b_sync_cursor', { p_through_date: range.toDate, p_job_id: job.id });
                if (cursorError) throw cursorError;
                executionResult.cursorAdvanced = true;
                executionResult.cursorAfter = range.toDate;
            }
            await this.updateK2BExecutionResult(job.id, executionResult);
            await this.updateJobStatus(job.id, 'success');
        } catch (error: any) {
            executionResult.rawReceiptPersistence.failed = Math.max(1, executionResult.rawReceiptPersistence.attempted - executionResult.rawReceiptPersistence.saved);
            executionResult.databaseSaveCompleted = false;
            executionResult.remoteReadState = executionResult.remoteReadState === 'not_started' ? 'failed' : 'partial';
            executionResult.failureStage = executionResult.failureStage || (error?.message?.includes('K2B_GRID_SCHEMA_MISMATCH') ? 'K2B_GRID_SCHEMA_MISMATCH' : error?.message?.includes('LOGIN_FAILED') ? 'LOGIN_FAILED' : error?.message?.includes('QUERY_FAILED') ? 'QUERY_FAILED' : 'persist_or_verify');
            await this.updateK2BExecutionResult(job.id, executionResult);
            await this.updateJobStatus(job.id, 'failed', error?.message || 'K2B 원본 동기화 실패');
        }
    }

    /**
     * K2B 보고서 자동 업로드 작업 처리
     */
    /** K2B 업로드와 같은 daemon에서 직렬 실행되는 읽기 전용 실제결과 검증이다. */
    private async processK2BVerifyJob(job: any) {
        const resultDate = String(job.payload?.resultDate ?? "");
        const executionResult: Record<string, any> = {
            mode: 'read_only',
            resultDate,
            trigger: resolveK2BVerifyTrigger(job.payload),
            serializationDisposition: job.payload?.serializationDisposition ?? 'unknown',
            remoteK2BReadAttempted: false,
            remoteK2BReadExecuted: false,
            remoteReadState: 'not_started',
            candidateCounts: { dated: 0, manual: 0, total: 0 },
            queriedDates: [],
            remoteRowCount: 0,
            matchCounts: { matched: 0, ambiguous: 0, unmatched: 0, green: 0, yellow: 0, red: 0 },
            persistence: { attempted: 0, saved: 0, unchanged: 0, failed: 0 },
            databaseSaveCompleted: false,
            uploadExecuted: false,
            failureStage: null,
        };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(resultDate)) {
            executionResult.failureStage = 'validate_result_date';
            await this.updateK2BExecutionResult(job.id, executionResult);
            await this.updateJobStatus(job.id, 'failed', 'K2B 검증일 형식이 올바르지 않습니다.');
            return;
        }
        const supabase = await createClient();
        await this.updateK2BExecutionResult(job.id, executionResult);
        // K2B 대표계정은 이 로컬 worker의 K2B_ID/K2B_PW만 사용한다. 요청자 DB credential은 읽지 않는다.
        const verificationRange = job.payload?.fromDate && job.payload?.toDate
            ? { fromDate: String(job.payload.fromDate), toDate: String(job.payload.toDate) }
            : buildGeneralK2BVerificationRange(resultDate);
        const journalFields = 'id, code, business_name, industrial_accident_number, commencement_number, measurement_year, measurement_period, k2b_status, k2b_send_date, k2b_verified_status, k2b_verified_at, k2b_verified_send_date, k2b_verified_result_date, k2b_verified_remote_status, k2b_consistency_status, k2b_consistency_note, k2b_verification_error, k2b_verification_attempted_at';
        const { data: datedJournals, error: datedJournalError } = await supabase.from('measurement_journal')
            .select(journalFields)
            // measurement_journal DATE는 KST 업무일이다. UTC 시각 범위로 변환하지 않는다.
            .gte('k2b_send_date', verificationRange.fromDate)
            .lte('k2b_send_date', verificationRange.toDate);
        // 직원이 K2B에서 직접 처리해 내부 전송일이 비어 있는 최근 후보도 별도 조회한다.
        // 이들은 정확히 한 건이 맞더라도 YELLOW만 기록하며 원래 입력값은 절대 바꾸지 않는다.
        const reportScopeKeys = new Set(inclusiveK2BDates(verificationRange).map((date) => {
            const scope = getReportProcessingPeriodForDate(date);
            return `${scope.year}|${scope.period}`;
        }));
        const reportYears = Array.from(new Set(Array.from(reportScopeKeys).map((key) => Number(key.split('|')[0]))));
        const { data: reportBusinessRows, error: reportBusinessError } = await supabase.from('measurement_business')
            .select('code, year, period')
            .in('year', reportYears)
            .not('business_name', 'ilike', REPORT_PROCESSING_EXCLUDED_BUSINESS_NAME_PATTERN);
        const reportBusinesses = (reportBusinessRows || []).filter((row: any) => reportScopeKeys.has(`${row.year}|${row.period}`));
        const candidateReportCodes = Array.from(new Set(reportBusinesses.map((row: any) => row.code).filter(Boolean)));
        const reportTargetResult = candidateReportCodes.length > 0
            ? await supabase.from('measurement_target_business')
                .select('code, year, period, is_registered')
                .in('code', candidateReportCodes)
                .in('year', reportYears)
            : { data: [], error: null };
        const reportTargets = (reportTargetResult.data || []).filter((row: any) => reportScopeKeys.has(`${row.year}|${row.period}`));
        const reportCodes = selectReportProcessingCodes(reportBusinesses, reportTargets);
        const manualCandidateResult = reportCodes.length > 0
            ? await supabase.from('measurement_journal')
                .select(journalFields)
                .in('code', reportCodes)
                .in('measurement_year', reportYears)
                .is('k2b_send_date', null)
            : { data: [], error: null };
        const manualCandidateJournals = (manualCandidateResult.data || []).filter((row: any) =>
            reportScopeKeys.has(`${row.measurement_year}|${row.measurement_period}`)
        );
        const manualCandidateError = manualCandidateResult.error;
        if (datedJournalError || reportBusinessError || reportTargetResult.error || manualCandidateError) {
            executionResult.failureStage = 'load_candidates';
            await this.updateK2BExecutionResult(job.id, executionResult);
            await this.updateJobStatus(job.id, 'failed', datedJournalError?.message || reportBusinessError?.message || reportTargetResult.error?.message || manualCandidateError?.message || 'K2B 검증 대상을 조회하지 못했습니다.');
            return;
        }
        const journals = [...(datedJournals || []), ...(manualCandidateJournals || [])];
        executionResult.candidateCounts = {
            dated: datedJournals?.length || 0,
            manual: manualCandidateJournals?.length || 0,
            total: journals.length,
        };
        await this.updateK2BExecutionResult(job.id, executionResult);
        try {
            executionResult.fromDate = verificationRange.fromDate;
            executionResult.toDate = verificationRange.toDate;
            executionResult.remoteReadState = 'processing';
            executionResult.remoteK2BReadAttempted = true;
            await this.updateK2BExecutionResult(job.id, executionResult);
            const rangeGrid = await querySubmissionResultsForRange(verificationRange.fromDate, verificationRange.toDate);
            executionResult.remoteK2BReadExecuted = true;
            executionResult.queriedDates = [verificationRange.fromDate, verificationRange.toDate];
            executionResult.remoteRowCount = rangeGrid.rows.length;
            executionResult.remoteExpectedRowCount = rangeGrid.expectedRowCount;
            executionResult.gridReadMethod = rangeGrid.readMethod;
            executionResult.gridReadComplete = rangeGrid.completeness;
            const rangeResults = rangeGrid.rows.map((row) => ({ managementNumber: row.managementNumber, commencementNumber: row.commencementNumber, companyName: row.companyName, submissionDate: row.actualSubmissionDate, status: row.status, errorViewAvailable: row.errorViewAvailable, errorDetail: row.errorDetail, submissionNumber: row.submissionNumber, identityConflict: row.identityConflict, businessYear: row.businessYear, half: row.half }));
            // 과거 미해결 건은 오늘 날짜에 억지로 대입하지 않고 각 내부 전송일별로 재조회한다.
            const journalsBySendDate = new Map<string, any[]>();
            for (const journal of journals || []) {
                const sendDate = String(journal.k2b_send_date ?? '');
                if (!/^\d{4}-\d{2}-\d{2}$/.test(sendDate)) continue;
                journalsBySendDate.set(sendDate, [...(journalsBySendDate.get(sendDate) || []), journal]);
            }
            const manualCandidates = (manualCandidateJournals || []).filter((journal) => !journal.k2b_send_date);
            if (manualCandidates.length > 0) {
                journalsBySendDate.set(resultDate, [...(journalsBySendDate.get(resultDate) || []), ...manualCandidates]);
            }
            const reconciledWithJournal: { sendDate: string; journal: any; item: ReturnType<typeof reconcileK2BSubmissionResults>[number] }[] = [];
            for (const [sendDate, dateJournals] of journalsBySendDate) {
                // 날짜는 verdict 비교 대상이다. K2B 행을 날짜로 먼저 거르면 같은 두
                // 식별자의 실제 접수일 차이를 "미접수"로 잘못 감춘다.
                const remoteResults = rangeResults;
                const reconciled = reconcileK2BSubmissionResults(dateJournals.map((journal) => ({
                    journalId: journal.id, code: String(journal.code ?? ''), industrialAccidentNumber: journal.industrial_accident_number, commencementNumber: journal.commencement_number, businessName: String(journal.business_name ?? ''), measurementYear: journal.measurement_year, measurementPeriod: journal.measurement_period, resultDate: sendDate,
                    previousVerifiedStatus: journal.k2b_verified_status, previousVerifiedAt: journal.k2b_verified_at,
                    internalK2BStatus: journal.k2b_status, internalK2BSendDate: journal.k2b_send_date,
                })), remoteResults, rangeGrid);
                for (let index = 0; index < reconciled.length; index++) {
                    const item = reconciled[index];
                    if (item.matchMethod === 'AMBIGUOUS') executionResult.matchCounts.ambiguous += 1;
                    else if (item.matchMethod === 'NONE') executionResult.matchCounts.unmatched += 1;
                    else executionResult.matchCounts.matched += 1;
                    if (item.state === 'GREEN') executionResult.matchCounts.green += 1;
                    else if (item.state === 'RED') executionResult.matchCounts.red += 1;
                    else executionResult.matchCounts.yellow += 1;
                    reconciledWithJournal.push({ sendDate, journal: dateJournals[index], item });
                }
            }
            executionResult.remoteReadState = rangeGrid.completeness === 'COMPLETE' ? 'completed' : 'partial';
            for (const { sendDate, journal, item } of reconciledWithJournal) {
                const attemptedAt = getKSTISOString();
                executionResult.persistence.attempted += 1;
                const update = selectChangedK2BReconciliationUpdate(item, journal, attemptedAt);
                if (update) {
                    const { data: updatedRows, error: updateError } = await supabase.from('measurement_journal').update(update).eq('id', journal.id).select('id');
                    if (updateError) throw updateError;
                    if (updatedRows?.length !== 1) throw new K2BJournalPersistenceError(`검증 결과 저장 대상이 정확히 1건이 아닙니다: ${journal.id}`);
                    executionResult.persistence.saved += 1;
                } else executionResult.persistence.unchanged += 1;
            }
            executionResult.verificationRows = reconciledWithJournal.map(({ journal, item }) => ({
                journalId: journal.id,
                code: String(journal.code ?? ''),
                businessName: String(journal.business_name ?? ''),
                industrialAccidentNumber: journal.industrial_accident_number ?? null,
                commencementNumber: journal.commencement_number ?? null,
                verdict: item.verdict,
                actualStatus: item.match?.status ?? null,
                actualSubmissionDate: item.match?.submissionDate ?? null,
                internalStatus: item.match && shouldReflectActualK2BStatus(item)
                    && journal.k2b_send_date === item.match.submissionDate
                    ? item.match.status
                    : journal.k2b_status ?? null,
                internalSubmissionDate: journal.k2b_send_date ?? null,
                submissionNumber: item.match?.submissionNumber ?? null,
                errorViewAvailable: item.match ? hasK2BReceiptError(item.match) : false,
                errorDetail: item.match?.errorDetail ?? null,
                approvalRequired: item.verdict === '날짜 불일치' || item.verdict === '내부 전송일자 없음',
            }));
            executionResult.databaseSaveCompleted = executionResult.persistence.saved + executionResult.persistence.unchanged === executionResult.persistence.attempted;
            await this.updateK2BExecutionResult(job.id, executionResult);
            await this.updateJobStatus(job.id, 'success');
        } catch (error: any) {
            executionResult.remoteReadState = executionResult.remoteK2BReadExecuted ? 'partial' : 'failed';
            executionResult.failureStage = executionResult.remoteK2BReadExecuted ? 'reconcile_or_persist' : 'remote_read';
            const attemptedAt = getKSTISOString();
            const persistenceErrors: string[] = [];
            for (const journal of journals || []) {
                const staleState = verificationFailureState(journal.k2b_verified_status);
                const { error: updateError } = await supabase.from('measurement_journal').update({
                    k2b_consistency_status: staleState,
                    k2b_consistency_note: 'K2B 읽기 전용 검증 실패: 이전 성공값은 보존됨',
                    k2b_verification_error: error?.message || String(error),
                    k2b_verification_attempted_at: attemptedAt,
                }).eq('id', journal.id);
                if (updateError) persistenceErrors.push(`${journal.id}: ${updateError.message}`);
            }
            executionResult.persistence.failed = Math.max(
                executionResult.persistence.attempted - executionResult.persistence.saved,
                persistenceErrors.length,
            );
            executionResult.databaseSaveCompleted = false;
            await this.updateK2BExecutionResult(job.id, executionResult);
            const baseMessage = error?.message || 'K2B 읽기 전용 검증 실패';
            await this.updateJobStatus(job.id, 'failed', persistenceErrors.length
                ? `${baseMessage}; 검증 상태 저장 실패: ${persistenceErrors.join(', ')}`
                : baseMessage);
        }
    }

    private async createK2BJobSupabaseClient() {
        return createClient();
    }

    private createK2BJobService() {
        return new K2BService();
    }

    private findK2BJobReportFiles(input: Parameters<typeof findReportFiles>[0]) {
        return findReportFiles(input);
    }

    private async waitForK2BPostUploadGrid() {
        await new Promise(resolve => setTimeout(resolve, 10000));
    }

    private async processK2BJob(job: any) {
        const supabase = await this.createK2BJobSupabaseClient();
        const payload = job.payload || {};
        const targets = payload.targets || [];
        const requestUser = payload.requestUser || null;
        const calendarSyncApiUrl = payload.calendarSyncApiUrl as string | undefined;

        if (targets.length === 0) {
            await this.updateJobStatus(job.id, 'failed', '업로드 대상 업체 정보(payload)가 비어있습니다.');
            return;
        }

        // 요청자 인증/권한은 유지하되 K2B credential은 대표계정 환경변수만 사용한다.
        if (!requestUser || !requestUser.id) {
            await this.updateJobStatus(job.id, 'failed', 'K2B 업로드를 요청한 사용자 세션 정보가 누락되었습니다.');
            return;
        }

        const k2b = this.createK2BJobService();
        this.currentK2BService = k2b; // Graceful Shutdown을 위해 등록
        const results: K2BPostUploadResult[] = [];

        try {
            await k2b.init();
            await k2b.login();

            for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
                const target = targets[targetIndex];
                const businessCode = String(target.code || '코드없음');
                const nextBusinessCode = targets[targetIndex + 1]?.code
                    ? String(targets[targetIndex + 1].code)
                    : null;
                console.log(
                    `[WorkerDaemon][K2B][${businessCode}] 대상 처리 시작 (${targetIndex + 1}/${targets.length})`
                );
                if (await this.isCancelRequested(job.id)) {
                    await this.cancelJob(job.id, requestUser, 'K2B 업로드');
                    return;
                }
                try {
                    // 1. Z드라이브 파일 찾기
                    const files = this.findK2BJobReportFiles({
                        year: target.year.toString(),
                        semester: target.period,
                        companyName: target.business_name
                    });

                    const previousTarget = targets[targetIndex - 1];
                    const previousFiles = previousTarget
                        ? this.findK2BJobReportFiles({
                            year: previousTarget.year.toString(),
                            semester: previousTarget.period,
                            companyName: previousTarget.business_name
                        })
                        : null;
                    await k2b.logBusinessBoundaryState(
                        businessCode,
                        previousTarget?.code ? String(previousTarget.code) : null,
                        previousFiles?.dataFile?.path || null,
                        files.dataFile?.path || null
                    );

                    // 2. K2B 업로드 동작 수행
                    const uploadRes = await k2b.uploadReport(target.business_name, {
                        dataFile: files.dataFile,
                        drawings: files.drawings,
                        drawingFolderPath: files.drawingFolderPath
                    }, businessCode);

                    console.log(
                        `[WorkerDaemon][K2B][${businessCode}] 첨부 결과: ${uploadRes.success ? '성공' : '실패'} / 상태=${uploadRes.status}`
                    );

                    // uploadReport 결과는 실행 결과일 뿐 K2B 실제 접수현황이 아니다.
                    // COMPLETE Grid 재조회 전에는 journal의 K2B 상태/접수일/발신자를 건드리지 않는다.
                    results.push(beginK2BPostUploadResult({
                        code: target.code,
                        companyName: target.business_name,
                        year: target.year,
                        period: target.period,
                        uploadSucceeded: uploadRes.success,
                        uploadStatus: uploadRes.status,
                        error: uploadRes.error,
                        failureStage: uploadRes.failureStage
                    }));

                    if (!uploadRes.success) {
                        // 개별 업체 실패 알림
                        await this.notifyAllManagers('error', `[K2B 업로드 실패] ${target.business_name} 실패: ${uploadRes.error}`);
                    }

                } catch (err: any) {
                    console.error(`[WorkerDaemon K2B Fail] ${target.business_name}:`, err);
                    results.push(beginK2BPostUploadResult({
                        code: target.code,
                        companyName: target.business_name,
                        year: target.year,
                        period: target.period,
                        uploadSucceeded: false,
                        failureStage: 'attachment-confirm',
                        error: err.message || '알 수 없는 업로드 에러'
                    }));
                    await this.notifyAllManagers('error', `[K2B 업로드 오류] ${target.business_name}: ${err.message}`);
                } finally {
                    console.log(
                        nextBusinessCode
                            ? `[WorkerDaemon][K2B][${businessCode}] 대상 처리 종료, 다음 대상 진행: ${nextBusinessCode}`
                            : `[WorkerDaemon][K2B][${businessCode}] 대상 처리 종료, 다음 대상 없음`
                    );
                }
            }

            // 모든 업체 완료 후 그리드 접수현황 조회 및 최종 상태 보정 (기존 파이썬/API 복제)
            if (await this.isCancelRequested(job.id)) {
                await k2b.quit();
                await this.cancelJob(job.id, requestUser, 'K2B 업로드');
                return;
            }

            let grid: Awaited<ReturnType<typeof k2b.readCurrentSubmissionResults>> | null = null;
            try {
                console.log("[WorkerDaemon K2B] 전송 후 10초 대기 중...");
                await this.waitForK2BPostUploadGrid();
                grid = await k2b.readCurrentSubmissionResults();
            } catch (gridReadErr: any) {
                console.error("[WorkerDaemon K2B] 접수 현황 그리드 조회 실패:", gridReadErr.message);
                const confirmationError = `K2B 접수현황 Grid 확인 실패: ${gridReadErr.message || '알 수 없는 조회 오류'}`;
                for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
                    results[resultIndex] = markK2BGridConfirmationFailure(results[resultIndex], confirmationError);
                }
            }

            if (grid) {
                if (grid.completeness !== 'COMPLETE') {
                    // 불완전/시스템 실패성 Grid는 이전 정상 결과를 결과 확인 필요로 덮어쓰지 않는다.
                    for (let resultIndex = 0; resultIndex < results.length; resultIndex++) {
                        results[resultIndex] = markK2BGridConfirmationFailure(
                            results[resultIndex],
                            'K2B 접수현황 전체 조회가 완료되지 않아 최종 상태를 반영하지 않음',
                        );
                    }
                    console.warn('[WorkerDaemon K2B] post-upload Grid incomplete; final journal reconciliation skipped: ' + grid.completeness);
                }
                if (grid.completeness === 'COMPLETE') {
                const gridResults = grid.rows.map((row) => ({
                    managementNumber: row.managementNumber,
                    commencementNumber: row.commencementNumber,
                    companyName: row.companyName,
                    submissionDate: row.actualSubmissionDate,
                    status: row.status,
                    errorViewAvailable: row.errorViewAvailable,
                    errorDetail: row.errorDetail,
                    submissionNumber: row.submissionNumber,
                    identityConflict: row.identityConflict,
                    businessYear: row.businessYear,
                    half: row.half,
                }));

                // 최종 Grid 결과는 대상 전체의 현재 값과 한 번만 대조한다. code/year/period
                // 의 Cartesian 범위에서 조회하되, 아래 Map은 정확한 세 키로만 사용한다.
                const targetCodes = Array.from(new Set(targets.map((target: any) => String(target.code ?? ''))));
                const targetYears = Array.from(new Set(targets.map((target: any) => target.year)));
                const targetPeriods = Array.from(new Set(targets.map((target: any) => target.period)));
                const { data: postUploadJournals, error: postUploadJournalError } = await supabase
                    .from('measurement_journal')
                    .select('code, measurement_year, measurement_period, k2b_status, k2b_send_date, k2b_sender')
                    .in('code', targetCodes)
                    .in('measurement_year', targetYears)
                    .in('measurement_period', targetPeriods);
                if (postUploadJournalError) throw postUploadJournalError;
                const postUploadJournalByKey = new Map((postUploadJournals || []).map((journal: any) => [
                    [journal.code, journal.measurement_year, journal.measurement_period]
                        .map((value) => String(value ?? '').trim()).join('\u0000'),
                    journal,
                ]));

                const finalizedTargetKeys = new Set<string>();
                for (const matchTarget of targets) {
                    const finalizedTargetKey = [matchTarget.code, matchTarget.year, matchTarget.period]
                        .map((value) => String(value ?? '').trim())
                        .join('\u0000');
                    if (finalizedTargetKeys.has(finalizedTargetKey)) continue;
                    finalizedTargetKeys.add(finalizedTargetKey);

                    const rIdx = results.findIndex((result) => result.code === matchTarget.code
                        && result.year === matchTarget.year
                        && result.period === matchTarget.period);
                    const uploadResult = rIdx === -1 ? null : results[rIdx];
                    // 과거 Grid의 정상 행은 이번 업로드가 실패한 target을 성공으로 바꾸지 않는다.
                    if (!uploadResult?.uploadSucceeded) continue;
                    const [reconciled] = reconcileK2BSubmissionResults([{
                        code: String(matchTarget.code || ''),
                        industrialAccidentNumber: matchTarget.industrial_accident_number,
                        commencementNumber: matchTarget.commencement_number,
                        businessName: String(matchTarget.business_name || ''),
                        resultDate: getKSTDateString(),
                        measurementYear: matchTarget.year,
                        measurementPeriod: matchTarget.period,
                        internalK2BStatus: null,
                        internalK2BSendDate: getKSTDateString(),
                    }], gridResults, grid);
                    const gr = reconciled?.match;
                    if (!gr || reconciled.matchMethod !== 'exact_keys') {
                        console.log(`[WorkerDaemon K2B] exact-key result unresolved: target=${matchTarget.code} method=${reconciled?.matchMethod || 'NONE'}`);
                        results[rIdx] = finalizeK2BPostUploadResult(uploadResult, {
                            gridComplete: true,
                            exactCanonicalMatch: false,
                            latestNormal: false,
                            status: '결과 확인 필요',
                            error: 'K2B 접수현황에서 이번 업로드 target의 canonical 4-key 결과를 확인하지 못함',
                        });
                        continue;
                    }

                    const isObservedNormal = String(gr.status || '').trim() === '\uC815\uC0C1\uCC98\uB9AC' && !hasK2BReceiptError(gr);
                    const isConfirmedNormal = isObservedNormal
                        && reconciled.state === 'GREEN'
                        && reconciled.verdict === '\uC815\uC0C1';
                    const calendarSyncDecision = decideK2BCalendarSync({
                        exactMatch: isConfirmedNormal,
                        receipt: gr,
                        measurementPeriod: matchTarget.period,
                    });
                    const effectiveStatus = journalStatusForK2BReconciliation(reconciled);
                    // 업로드 진행 상태를 저장하지 않는다. 방금 읽은 실제 K2B 결과만 공통 정책으로 반영한다.
                    const desiredGridData = {
                        k2b_sender: '\uB300\uD45C\uACC4\uC815',
                        k2b_status: effectiveStatus,
                        k2b_send_date: isConfirmedNormal && /^\d{4}-\d{2}-\d{2}$/.test(String(gr.submissionDate || ''))
                            ? gr.submissionDate ?? null : null,
                    };
                    const postUploadUpdate = selectChangedK2BPostUploadUpdate(
                        postUploadJournalByKey.get(finalizedTargetKey),
                        desiredGridData,
                    );
                    if (postUploadUpdate) await requireK2BJournalPersistence(
                        supabase.from('measurement_journal').update(postUploadUpdate)
                            .eq('code', matchTarget.code)
                            .eq('measurement_year', matchTarget.year)
                            .eq('measurement_period', matchTarget.period)
                    );

                    results[rIdx] = finalizeK2BPostUploadResult(uploadResult, {
                        gridComplete: true,
                        exactCanonicalMatch: true,
                        latestNormal: isConfirmedNormal,
                        status: effectiveStatus,
                        error: gr.errorDetail
                            || (isObservedNormal ? 'K2B 접수현황 전체 조회가 완료되지 않아 정상 확정하지 않음' : effectiveStatus),
                    });

                    if (calendarSyncDecision.shouldSync) {
                        const apiPeriod = calendarSyncDecision.period;
                        const calendarSync = await this.syncCalendarAfterK2B(
                            calendarSyncApiUrl,
                            matchTarget.code,
                            matchTarget.year,
                            apiPeriod
                        );
                        results[rIdx].calendarSyncSuccess = calendarSync.success;
                        results[rIdx].calendarSyncError = calendarSync.error;
                    } else if (calendarSyncDecision.reason === 'unsupported_period') {
                        const periodErr = `Unsupported measurement_period: ${matchTarget.period}`;
                        console.error(`[WorkerDaemon K2B] calendar sync skipped: code=${matchTarget.code} period=${String(matchTarget.period)}`);
                        results[rIdx].calendarSyncSuccess = false;
                        results[rIdx].calendarSyncError = periodErr;
                    }
                }
                }
            }

            // 브라우저 닫기
            await k2b.quit();

            // 최종 Job 상태 업데이트
            const finalSuccessCount = results.filter(r => r.success).length;
            const gridConfirmationFailures = results.filter((result) => result.uploadSucceeded
                && !result.success
                && result.failureStage === 'grid-confirmation');
            for (const result of results) {
                console.log(
                    `[K2B][${result.code}] FINAL=${result.success ? 'SUCCESS' : 'FAILED'}` +
                    `${result.success ? '' : ` stage=${result.failureStage || 'attachment-confirm'}`} status=${result.status || '자동화 오류'}`
                );
            }
            const calendarFailures = results.filter(r => r.success && r.calendarSyncSuccess === false);
            if (finalSuccessCount === targets.length && calendarFailures.length === 0) {
                await this.updateJobStatus(job.id, 'success');
                await this.createInAppNotification(
                    requestUser.id, 
                    'info', 
                    `[K2B 업로드 완료] ${targets[0]?.business_name}${targets.length > 1 ? ` 외 ${targets.length - 1}곳` : ''}의 K2B 자동 등록이 완료되었습니다.`
                );
            } else if (finalSuccessCount === targets.length) {
                const warning = `K2B 전송은 완료됐으나 캘린더 동기화 실패: ${calendarFailures.map(r => r.companyName).join(', ')}`;
                await this.updateJobStatus(job.id, 'success', warning);
                await this.createInAppNotification(
                    requestUser.id,
                    'warning',
                    `[K2B 업로드 완료/캘린더 확인 필요] ${warning}`
                );
                await this.notifyAllManagers('error', `[캘린더 동기화 실패] ${warning}`);
            } else if (finalSuccessCount > 0) {
                const partialMessage = gridConfirmationFailures.length > 0
                    ? `일부 최종 확인: ${finalSuccessCount}/${targets.length}개 완료, ${gridConfirmationFailures.length}개 Grid 결과 확인 필요`
                    : `일부 성공: ${finalSuccessCount}/${targets.length}개 완료`;
                await this.updateJobStatus(job.id, 'success', partialMessage);
                await this.createInAppNotification(
                    requestUser.id, 
                    'warning', 
                    `[K2B 일부 업로드] ${partialMessage}`
                );
            } else {
                const failDetails = targets.map((t: any) => t.business_name).join(', ');
                const errorReason = results[0]?.error || '자동화 프로세스 오류';
                const gridConfirmationOnly = gridConfirmationFailures.length > 0;
                const jobMessage = gridConfirmationOnly
                    ? `K2B 업로드 결과 확인 필요: ${errorReason}`
                    : `K2B 업로드 실패: ${errorReason}`;
                await this.updateJobStatus(job.id, 'failed', jobMessage);

                const errorMsg = gridConfirmationOnly
                    ? `[K2B 업로드 결과 확인 필요] ${failDetails}의 Grid 확인 실패. 사유: ${errorReason}`
                    : `[K2B 업로드 실패] ${failDetails} 업로드 실패. 사유: ${errorReason}`;
                await this.createInAppNotification(requestUser.id, 'error', errorMsg);
                await this.notifyAllManagers('error', errorMsg);
            }

            return results;

        } catch (error: any) {
            console.error("[WorkerDaemon] K2B 전체 작업 실패:", error);
            if (this.currentK2BService) {
                await this.currentK2BService.quit();
            }
            const errorMsg = `[K2B 매크로 오류] 백그라운드 처리 실패: ${error.message}`;
            await this.updateJobStatus(job.id, 'failed', error.message || 'K2B 매크로 가동 중 치명적 오류 발생');
            await this.createInAppNotification(requestUser.id, 'error', errorMsg);
            await this.notifyAllManagers('error', errorMsg);
        } finally {
            this.currentK2BService = null;
        }
    }

    private async syncCalendarAfterK2B(
        apiUrl: string | undefined,
        code: string,
        year: number | string,
        period: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await requestK2BCalendarSync(
                apiUrl,
                process.env.DOCUMENT_WORKER_TOKEN,
                { code, year, period }
            );
            console.log(
                `[WorkerDaemon K2B Sync] ${code} 서버 캘린더 검증 완료 ` +
                `(일정 ${result.syncedEventCount}/${result.count}건)`
            );
            return { success: true };
        } catch (error: any) {
            const message = error?.message || String(error);
            console.error(`[WorkerDaemon K2B Sync] Calendar sync failed for ${code}: ${message}`);
            return { success: false, error: message };
        }
    }

    /**
     * Job 상태 업데이트 공통 유틸
     */
    private async updateJobStatus(jobId: string, status: 'success' | 'failed' | 'cancelled', errorMsg: string | null = null) {
        try {
            const supabase = await createClient();
            const { error } = await supabase
                .from('background_jobs')
                .update({
                    status,
                    error_message: errorMsg,
                    finished_at: getKSTISOString(),
                    updated_at: getKSTISOString()
                })
                .eq('id', jobId);
            if (error) throw error;

            console.log(`[WorkerDaemon] Job 상태 업데이트 완료: ${jobId} -> ${status}`);
        } catch (e: any) {
            console.error(`[WorkerDaemon] Job 상태 업데이트 실패 (${jobId}):`, e.message);
            throw e;
        }
    }

    private async updateK2BExecutionResult(jobId: string, executionResult: Record<string, any>) {
        const supabase = await createClient();
        const { error } = await supabase
            .from('background_jobs')
            .update({ execution_result: executionResult, updated_at: getKSTISOString() })
            .eq('id', jobId);
        if (error) throw error;
    }

    /**
     * 특정 사용자에게 인앱 알림 전송
     */
    private async createInAppNotification(userId: number | null, type: string, message: string) {
        if (!userId) return;
        try {
            const supabase = await createClient();
            await supabase
                .from('notifications')
                .insert({
                    user_id: userId,
                    type,
                    message,
                    is_read: false
                });
        } catch (e: any) {
            console.error("[WorkerDaemon] 인앱 알림 생성 실패:", e.message);
        }
    }

    /**
     * 모든 담당 관리자(is_journal_manager = true)에게 알림 전송
     */
    private async notifyAllManagers(type: string, message: string) {
        try {
            const supabase = await createClient();
            const { data: managers } = await supabase
                .from('users')
                .select('id')
                .eq('is_journal_manager', true);

            if (managers && managers.length > 0) {
                const notifications = managers.map(m => ({
                    user_id: m.id,
                    type,
                    message,
                    is_read: false
                }));

                await supabase.from('notifications').insert(notifications);
            }
        } catch (e: any) {
            console.error("[WorkerDaemon] 관리자 전원 알림 실패:", e.message);
        }
    }

    /**
     * Graceful Shutdown (프로세스 갑작스런 강제종료 시 자원 회수 및 Lock 롤백)
     */
    private async handleShutdown(signal: string) {
        console.log(`[WorkerDaemon] ${signal} 종료 신호 감지. 자원 정지 및 클린업을 시작합니다...`);
        this.stop();

        // 1. 실행 중인 크롬 브라우저 닫기
        if (this.currentK2BService) {
            try {
                console.log("[WorkerDaemon] 열려 있는 K2B 크롬 브라우저 닫는 중...");
                await this.currentK2BService.quit();
            } catch (e) {
                // 무시
            }
        }

        // 2. 현재 처리 중이던 작업을 'failed'로 롤백
        if (this.currentJobId) {
            try {
                console.log(`[WorkerDaemon] 진행 중이던 작업(${this.currentJobId})을 실패 상태로 롤백 중...`);
                // 비동기 처리가 프로세스 종료 전에 처리되도록 동기식 커넥션을 사용하지 않고 REST API 요청을 보장하기 위해 즉각 완료 처리 시도
                const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
                const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
                if (supabaseUrl && supabaseServiceKey) {
                    await fetch(`${supabaseUrl}/rest/v1/background_jobs?id=eq.${this.currentJobId}`, {
                        method: 'PATCH',
                        headers: {
                            'apikey': supabaseServiceKey,
                            'Authorization': `Bearer ${supabaseServiceKey}`,
                            'Content-Type': 'application/json',
                            'Prefer': 'return=minimal'
                        },
                        body: JSON.stringify({
                            status: 'failed',
                            error_message: '로컬 서버 재시작 또는 갑작스러운 프로세스 종료로 작업 중단됨',
                            updated_at: new Date().toISOString()
                        })
                    });
                }
            } catch (e: any) {
                console.error("[WorkerDaemon] 종료 중 작업 롤백 실패:", e.message);
            }
        }

        console.log("[WorkerDaemon] 클린업 완료. 프로세스를 안전하게 종료합니다.");
        process.exit(0);
    }
}
