import { BounceChecker } from '../email/bounce-checker';
import { backupDatabase } from '../../scripts/backup-db';
import { exec } from "child_process";
import { join } from "path";
import { createClient } from '../supabase/server';
import { getKSTISOString } from '../utils/date-utils';

/**
 * 전역 백그라운드 작업 관리자
 */
export class BackgroundTasks {
    private static instance: BackgroundTasks;
    private initialized: boolean = false;

    private constructor() {}

    public static getInstance(): BackgroundTasks {
        if (!BackgroundTasks.instance) {
            BackgroundTasks.instance = new BackgroundTasks();
        }
        return BackgroundTasks.instance;
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
        });

        cron.schedule('0 12 * * *', async () => {
            console.log("[BackgroundTasks] 12:00 MES 자동 다운로드 작업을 기동합니다...");
            await BackgroundTasks.getInstance().runMesDownloadScript(false);
        });

        cron.schedule('0 14 * * *', async () => {
            console.log("[BackgroundTasks] 14:00 최종 MES 자동 다운로드 및 연동 여부 점검을 기동합니다...");
            await BackgroundTasks.getInstance().runMesDownloadScript(true);
        });

        this.initialized = true;
        console.log("[BackgroundTasks] 스케줄러 등록 완료 (반송 메일 & DB 백업 & MES 다운로드 3회 스케줄).");
    }

    /**
     * MES 다운로드 파이썬 스크립트 실행
     */
    public runMesDownloadScript(isFinalCheck: boolean = false): Promise<boolean> {
        return new Promise((resolve) => {
            const scriptPath = join(process.cwd(), 'mes_download.py');
            console.log(`[BackgroundTasks] MES 자동 다운로드 스크립트 실행 시작: ${scriptPath}`);
            
            // 윈도우 깡통 PC 환경을 고려해 python 명령어로 백그라운드 호출
            exec(`python "${scriptPath}"`, async (error, stdout, stderr) => {
                if (error) {
                    console.error("[BackgroundTasks] MES 자동 다운로드 스크립트 실행 중 에러 발생:", error);
                    resolve(false);
                    return;
                }
                
                console.log("[BackgroundTasks] MES 자동 다운로드 스크립트 실행 성공.");
                if (stdout) console.log("[BackgroundTasks] stdout:", stdout);
                if (stderr) console.warn("[BackgroundTasks] stderr:", stderr);
                
                // 14:00 최종 체크 시점일 경우 미등록 업체 대상 일지담당자 알림 발송
                if (isFinalCheck) {
                    try {
                        await BackgroundTasks.getInstance().checkAndNotifyUnregisteredBusinesses();
                    } catch (checkErr: any) {
                        console.error("[BackgroundTasks] 14:00 최종 미등록 예비조사 업체 점검 중 오류:", checkErr.message);
                    }
                }
                
                resolve(true);
            });
        });
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
