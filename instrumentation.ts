/**
 * Next.js Instrumentation 
 * 서버 시작 시 백그라운드 작업을 등록하기 위한 진입점
 */
export async function register() {
    // 서버 사이드 프로세스일 때만 실행 (Edge Runtime 제외)
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        try {
            const { BackgroundTasks } = await import('./lib/scheduler/background-tasks');
            console.log("[Instrumentation] 서버 프로세스 감지. 스케줄러를 초기화합니다...");
            BackgroundTasks.getInstance().init();
        } catch (error) {
            console.error("[Instrumentation] 스케줄러 초기화 중 오류 발생:", error);
        }
    }
}
