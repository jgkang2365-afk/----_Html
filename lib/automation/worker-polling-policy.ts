export const WORKER_ACTIVE_POLL_MS = 5_000;
export const WORKER_IDLE_POLL_MS = [15_000, 30_000] as const;
export const NATIONAL_SUPPORT_STALE_WATCHDOG_MS = 5 * 60 * 1_000;
export const NATIONAL_SUPPORT_STALE_THRESHOLD_MS = 10 * 60 * 1_000;

export type WorkerPollingState = {
    idlePollCount: number;
    delayMs: number;
};

export function nextWorkerPollingState(
    idlePollCount: number,
    activityDetected: boolean,
): WorkerPollingState {
    if (activityDetected) {
        return {
            idlePollCount: 0,
            delayMs: WORKER_ACTIVE_POLL_MS,
        };
    }

    const nextIdlePollCount = Math.min(
        Math.max(0, idlePollCount) + 1,
        WORKER_IDLE_POLL_MS.length,
    );

    return {
        idlePollCount: nextIdlePollCount,
        delayMs: WORKER_IDLE_POLL_MS[nextIdlePollCount - 1],
    };
}
