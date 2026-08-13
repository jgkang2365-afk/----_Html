export type WorkerWakeReason =
  | "startup"
  | "realtime-event"
  | "realtime-reconnected"
  | "safety-check"
  | "available-at";

export type WorkerWakeHandler = (
  reason: WorkerWakeReason,
  includeMaintenance: boolean,
) => Promise<void>;

export interface QueueDrainHooks {
  includeMaintenance: boolean;
  maxJobs: number;
  shouldContinue: () => boolean;
  recoverStale: () => Promise<void>;
  processNext: () => Promise<boolean>;
  scheduleNext: () => Promise<void>;
}

export async function runQueueDrainCycle(hooks: QueueDrainHooks): Promise<number> {
  if (hooks.includeMaintenance) {
    await hooks.recoverStale();
  }

  let processed = 0;
  while (hooks.shouldContinue() && processed < hooks.maxJobs) {
    if (!await hooks.processNext()) break;
    processed += 1;
  }
  await hooks.scheduleNext();
  return processed;
}

/**
 * Realtime 중복 신호를 한 개의 실행 흐름으로 합칩니다.
 * 실행 중 도착한 신호는 한 번의 후속 확인으로 합쳐 작업 유실과 중복 실행을 함께 막습니다.
 */
export class RealtimeWakeCoordinator {
  private running = false;
  private queued = false;
  private queuedMaintenance = false;
  private latestReason: WorkerWakeReason = "realtime-event";
  private stopped = false;

  constructor(private readonly handler: WorkerWakeHandler) {}

  async wake(reason: WorkerWakeReason, includeMaintenance = false): Promise<void> {
    if (this.stopped) return;

    this.queued = true;
    this.queuedMaintenance ||= includeMaintenance;
    this.latestReason = reason;
    if (this.running) return;

    this.running = true;
    try {
      while (this.queued && !this.stopped) {
        const nextReason = this.latestReason;
        const nextMaintenance = this.queuedMaintenance;
        this.queued = false;
        this.queuedMaintenance = false;
        await this.handler(nextReason, nextMaintenance);
      }
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    this.stopped = true;
    this.queued = false;
    this.queuedMaintenance = false;
  }
}

export function millisecondsUntil(availableAt: string, now = Date.now()): number | null {
  const timestamp = Date.parse(availableAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, timestamp - now);
}
