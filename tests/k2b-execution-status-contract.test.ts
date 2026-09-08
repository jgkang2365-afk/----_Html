import assert from "node:assert/strict";
import test from "node:test";
import { toK2BExecutionStatus } from "../lib/report-processing/k2b-execution-status";

test("K2B 원본 동기화 상태 계약은 execution_result에 저장된 관측값만 그대로 전달한다", () => {
  const execution = toK2BExecutionStatus({
    id: "6213b6d0-fbd9-48b3-905a-a24aa6f89d0f", status: "failed", error_message: "QUERY_FAILED: timeout",
    created_at: "2026-09-07T00:00:00.000Z", started_at: "2026-09-07T00:00:02.000Z", finished_at: "2026-09-07T00:00:03.000Z",
    execution_result: {
      trigger: "scheduled", fromDate: "2026-09-03", toDate: "2026-09-06", sourceHost: "worker-a", queriedDates: ["2026-09-03", "2026-09-04"],
      dateResults: [{ date: "2026-09-03", outcome: "SUCCESS_EMPTY", rowCount: 0 }, { date: "2026-09-04", outcome: "QUERY_FAILED", rowCount: 0 }],
      remoteK2BReadAttempted: true, remoteK2BReadExecuted: false, remoteReadState: "partial", cursorBefore: "2026-09-02", cursorAfter: null, cursorAdvanced: false,
      rawReceiptPersistence: { attempted: 4, saved: 3, failed: 1, insertedCount: 2, updatedCount: 1, unchangedCount: 0, fallbackKeyCount: 1 },
      journalVerification: { matched: 2, saved: 2 }, databaseSaveCompleted: false, uploadExecuted: false, failureStage: "QUERY_FAILED",
    },
  });

  assert.equal(execution.trigger, "scheduled");
  assert.equal(execution.fromDate, "2026-09-03");
  assert.equal(execution.toDate, "2026-09-06");
  assert.equal(execution.sourceHost, "worker-a");
  assert.deepEqual(execution.queriedDates, ["2026-09-03", "2026-09-04"]);
  assert.equal(execution.remoteK2BReadAttempted, true);
  assert.equal(execution.remoteK2BReadExecuted, false);
  assert.equal(execution.rawReceiptPersistence?.saved, 3);
  assert.equal(execution.cursorAfter, null);
  assert.equal(execution.failureStage, "QUERY_FAILED");
  assert.equal(execution.queueStatus, "failed");
  assert.equal(execution.lastError, "QUERY_FAILED: timeout");
});

test("기록되지 않은 실행 결과는 payload나 0/false 기본값으로 추론하지 않는다", () => {
  const execution = toK2BExecutionStatus({
    id: "6213b6d0-fbd9-48b3-905a-a24aa6f89d0f", status: "pending", error_message: null,
    created_at: null, started_at: null, finished_at: null, execution_result: null,
  });

  assert.equal(execution.trigger, null);
  assert.equal(execution.fromDate, null);
  assert.equal(execution.remoteK2BReadAttempted, null);
  assert.equal(execution.rawReceiptPersistence, null);
  assert.equal(execution.remoteReadState, null);
});
