import { BounceChecker } from '../email/bounce-checker';
import { backupDatabase } from '../../scripts/backup-db';

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

        console.log("[BackgroundTasks] 스케줄러 초기화 시작 (반송메일 및 DB백업)...");

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

        // 테스트용: 서버 시작 1분 후 한 번 실행 (필요시 주석 처리)
        // setTimeout(() => BounceChecker.getInstance().checkBounces(), 60000);

        this.initialized = true;
        console.log("[BackgroundTasks] 스케줄러 등록 완료 (반송 메일 체크 & 일일 DB 백업).");
    }
}
