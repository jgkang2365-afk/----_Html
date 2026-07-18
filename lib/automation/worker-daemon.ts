import { createClient } from '../supabase/server';
import { EmailService } from '../email/email-service';
import { K2BService } from './k2b-service';
import { findReportFiles } from '../utils/findReportFiles';
import { getKSTISOString, getKSTDateString } from '../utils/date-utils';
import { syncBusinessToCalendar } from "../google/sync-service";
import { getCalendarConfigurationStatus } from "../google/calendar";
import { processNationalSupportJob } from "./national-support-worker";

/**
 * 백그라운드 작업기 데몬 (Worker Daemon)
 * 로컬 서버 환경에서만 가동되며, background_jobs 테이블을 감시해
 * 이메일, K2B, 건강디딤돌 조회 작업을 비동기 처리합니다.
 */
export class WorkerDaemon {
    private static instance: WorkerDaemon;
    private pollingInterval: NodeJS.Timeout | null = null;
    private isProcessing: boolean = false;
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

        if (this.pollingInterval) {
            console.log("[WorkerDaemon] 이미 워커가 실행 중입니다.");
            return;
        }

        const calendarConfiguration = getCalendarConfigurationStatus();
        if (!calendarConfiguration.valid) {
            console.error(
                `[WorkerDaemon] 구글 캘린더 설정 오류: ${calendarConfiguration.errors.join(', ')}. ` +
                'K2B/일지 처리는 계속되지만 캘린더 동기화 실패가 사용자 알림에 표시됩니다.'
            );
        } else {
            console.log('[WorkerDaemon] 구글 캘린더 동기화 설정 확인 완료.');
        }

        console.log("[WorkerDaemon] 백그라운드 작업기(Worker Daemon)를 시작합니다. (5초 간격 감시)");
        this.pollingInterval = setInterval(() => this.poll(), 5000);
    }

    /**
     * 워커 정지
     */
    public stop() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            console.log("[WorkerDaemon] 백그라운드 작업기(Worker Daemon)를 정지했습니다.");
        }
    }

    /**
     * 큐 폴링 함수
     */
    private async poll() {
        // 현재 작업을 처리 중이면 중복 폴링 패스
        if (this.isProcessing) return;

        this.isProcessing = true;

        try {
            const supabase = await createClient();

            await this.recoverStaleNationalSupportJobs(supabase);

            // PENDING 상태인 가장 오래된 작업 1개 획득
            const { data: jobs, error } = await supabase
                .from('background_jobs')
                .select('*')
                .eq('status', 'pending')
                .order('created_at', { ascending: true })
                .limit(1);

            if (error) throw error;
            if (!jobs || jobs.length === 0) {
                this.isProcessing = false;
                return;
            }

            const job = jobs[0];

            // 낙관적 락(Optimistic Lock): 상태를 'processing'으로 업데이트하여 선점 시도
            const { data: updatedJobs, error: lockError } = await supabase
                .from('background_jobs')
                .update({ 
                    status: 'processing',
                    updated_at: getKSTISOString()
                })
                .eq('id', job.id)
                .eq('status', 'pending')
                .select();

            if (lockError) throw lockError;

            // 이미 다른 워커가 가져갔거나 낙관적 락 획득 실패 시 다음 루프로 패스
            if (!updatedJobs || updatedJobs.length === 0) {
                console.log(`[WorkerDaemon] 작업 선점 실패 (이미 다른 프로세스가 처리 중): ${job.id}`);
                this.isProcessing = false;
                return;
            }

            console.log(`[WorkerDaemon] 작업 선점 성공: ID = ${job.id}, Type = ${job.job_type}`);
            this.currentJobId = job.id;

            // 실제 작업 처리 분기
            if (job.job_type === 'email') {
                await this.processEmailJob(job);
            } else if (job.job_type === 'k2b') {
                await this.processK2BJob(job);
            } else if (job.job_type === 'national_support') {
                await this.processNationalSupportJob(job);
            } else {
                throw new Error(`알 수 없는 작업 유형: ${job.job_type}`);
            }

        } catch (e: any) {
            console.error("[WorkerDaemon] 폴링 루프 오류:", e.message);
        } finally {
            this.isProcessing = false;
            this.currentJobId = null;
        }
    }

    private async recoverStaleNationalSupportJobs(supabase: any) {
        const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
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
            await processNationalSupportJob(job.payload);
            await this.updateJobStatus(job.id, 'success');
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

    /**
     * K2B 보고서 자동 업로드 작업 처리
     */
    private async processK2BJob(job: any) {
        const supabase = await createClient();
        const payload = job.payload || {};
        const targets = payload.targets || [];
        const requestUser = payload.requestUser || null;

        if (targets.length === 0) {
            await this.updateJobStatus(job.id, 'failed', '업로드 대상 업체 정보(payload)가 비어있습니다.');
            return;
        }

        // K2B 계정 정보 가져오기 (요청자 ID 기준)
        if (!requestUser || !requestUser.id) {
            await this.updateJobStatus(job.id, 'failed', 'K2B 업로드를 요청한 사용자 세션 정보가 누락되었습니다.');
            return;
        }

        const { data: dbUser } = await supabase
            .from('users')
            .select('name, k2b_id, k2b_pw')
            .eq('id', requestUser.id)
            .single();

        if (!dbUser || !dbUser.k2b_id || !dbUser.k2b_pw) {
            await this.updateJobStatus(job.id, 'failed', `사용자(${requestUser.name})의 K2B 계정 정보(ID/PW)가 프로필에 설정되어 있지 않습니다.`);
            await this.createInAppNotification(requestUser.id, 'error', `[K2B 업로드 실패] K2B 계정 정보(ID/PW) 설정이 필요합니다.`);
            return;
        }

        const k2b = new K2BService();
        this.currentK2BService = k2b; // Graceful Shutdown을 위해 등록
        const results: any[] = [];
        let successCount = 0;

        try {
            await k2b.init();
            await k2b.login(dbUser.k2b_id, dbUser.k2b_pw);

            for (const target of targets) {
                if (await this.isCancelRequested(job.id)) {
                    await this.cancelJob(job.id, requestUser, 'K2B 업로드');
                    return;
                }
                try {
                    // 1. Z드라이브 파일 찾기
                    const files = findReportFiles({
                        year: target.year.toString(),
                        semester: target.period,
                        companyName: target.business_name
                    });

                    // 2. K2B 업로드 동작 수행
                    const uploadRes = await k2b.uploadReport(target.business_name, {
                        dataFile: files.dataFile,
                        drawings: files.drawings,
                        drawingFolderPath: files.drawingFolderPath
                    });

                    // 3. DB 상태 업데이트
                    const now = getKSTDateString();
                    const updateData: Record<string, any> = {
                        k2b_status: uploadRes.status
                    };

                    if (uploadRes.success) {
                        updateData.k2b_send_date = now;
                        updateData.k2b_sender = dbUser.name;
                    }

                    await supabase
                        .from('measurement_journal')
                        .update(updateData)
                        .eq('code', target.code)
                        .eq('measurement_year', target.year)
                        .eq('measurement_period', target.period);

                    const calendarSync = await this.syncCalendarAfterK2B(
                        supabase,
                        target.code,
                        target.year,
                        target.period
                    );

                    results.push({
                        code: target.code,
                        companyName: target.business_name,
                        success: uploadRes.success,
                        status: uploadRes.status,
                        error: uploadRes.error,
                        calendarSyncSuccess: calendarSync.success,
                        calendarSyncError: calendarSync.error
                    });

                    if (uploadRes.success) {
                        successCount++;
                    } else {
                        // 개별 업체 실패 알림
                        await this.notifyAllManagers('error', `[K2B 업로드 실패] ${target.business_name} 실패: ${uploadRes.error}`);
                    }

                } catch (err: any) {
                    console.error(`[WorkerDaemon K2B Fail] ${target.business_name}:`, err);
                    results.push({
                        code: target.code,
                        companyName: target.business_name,
                        success: false,
                        error: err.message || '알 수 없는 업로드 에러'
                    });
                    await this.notifyAllManagers('error', `[K2B 업로드 오류] ${target.business_name}: ${err.message}`);
                }
            }

            // 모든 업체 완료 후 그리드 접수현황 조회 및 최종 상태 보정 (기존 파이썬/API 복제)
            if (await this.isCancelRequested(job.id)) {
                await k2b.quit();
                await this.cancelJob(job.id, requestUser, 'K2B 업로드');
                return;
            }

            try {
                console.log("[WorkerDaemon K2B] 전송 후 10초 대기 중...");
                await new Promise(resolve => setTimeout(resolve, 10000));
                const gridResults = await k2b.extractResults();

                for (const gr of gridResults) {
                    const matchTarget = targets.find((t: any) =>
                        gr.companyName.includes(t.business_name) || t.business_name.includes(gr.companyName)
                    );
                    if (matchTarget) {
                        const updateGridData: Record<string, any> = { 
                            k2b_status: gr.status,
                            k2b_sender: dbUser.name
                        };

                        if (gr.status === '정상처리') {
                            updateGridData.k2b_send_date = getKSTDateString();
                        }

                        await supabase
                            .from('measurement_journal')
                            .update(updateGridData)
                            .eq('code', matchTarget.code)
                            .eq('measurement_year', matchTarget.year)
                            .eq('measurement_period', matchTarget.period);

                        const calendarSync = await this.syncCalendarAfterK2B(
                            supabase,
                            matchTarget.code,
                            matchTarget.year,
                            matchTarget.period
                        );

                        const rIdx = results.findIndex(r => r.code === matchTarget.code);
                        if (rIdx !== -1) {
                            results[rIdx].status = gr.status;
                            if (gr.status === '정상처리') {
                                results[rIdx].success = true;
                            }
                            results[rIdx].calendarSyncSuccess = calendarSync.success;
                            results[rIdx].calendarSyncError = calendarSync.error;
                        }
                    }
                }
            } catch (gridErr: any) {
                console.error("[WorkerDaemon K2B] 접수 현황 그리드 조회 실패:", gridErr.message);
            }

            // 브라우저 닫기
            await k2b.quit();

            // 최종 Job 상태 업데이트
            const finalSuccessCount = results.filter(r => r.success).length;
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
                await this.updateJobStatus(job.id, 'success', `일부 성공: ${finalSuccessCount}/${targets.length}개 완료`);
                await this.createInAppNotification(
                    requestUser.id, 
                    'warning', 
                    `[K2B 일부 업로드] ${finalSuccessCount}개 성공, ${targets.length - finalSuccessCount}개 실패하였습니다.`
                );
            } else {
                const failDetails = targets.map((t: any) => t.business_name).join(', ');
                const errorReason = results[0]?.error || '자동화 프로세스 오류';
                await this.updateJobStatus(job.id, 'failed', `K2B 업로드 실패: ${errorReason}`);

                const errorMsg = `[K2B 업로드 실패] ${failDetails} 업로드 실패. 사유: ${errorReason}`;
                await this.createInAppNotification(requestUser.id, 'error', errorMsg);
                await this.notifyAllManagers('error', errorMsg);
            }

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
        supabase: any,
        code: string,
        year: number | string,
        period: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            const result = await syncBusinessToCalendar(supabase, code, year, period);
            if (!result?.success) {
                throw new Error('캘린더 동기화 결과를 확인하지 못했습니다.');
            }
            console.log(
                `[WorkerDaemon K2B Sync] ${code} 캘린더 검증 완료 ` +
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
            await supabase
                .from('background_jobs')
                .update({
                    status,
                    error_message: errorMsg,
                    updated_at: getKSTISOString()
                })
                .eq('id', jobId);

            console.log(`[WorkerDaemon] Job 상태 업데이트 완료: ${jobId} -> ${status}`);
        } catch (e: any) {
            console.error(`[WorkerDaemon] Job 상태 업데이트 실패 (${jobId}):`, e.message);
        }
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


