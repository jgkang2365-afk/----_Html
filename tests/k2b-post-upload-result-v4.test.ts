import assert from "node:assert/strict";
import test from "node:test";
import {
  beginK2BPostUploadResult,
  finalizeK2BPostUploadResult,
  markK2BGridConfirmationFailure,
} from "../lib/automation/k2b-post-upload-result";
import { WorkerDaemon } from "../lib/automation/worker-daemon";

const uploaded = () => beginK2BPostUploadResult({
  code: "A-1",
  companyName: "테스트 사업장",
  year: 2026,
  period: "하반기",
  uploadSucceeded: true,
  uploadStatus: "업로드 완료",
});

test("v4 Test1: uploadReport 성공은 Grid 확정 전 final success가 아니다", () => {
  const result = uploaded();
  assert.equal(result.uploadSucceeded, true);
  assert.equal(result.gridConfirmedNormal, false);
  assert.equal(result.success, false);
  assert.equal(result.status, "결과 확인 필요");
});

test("v4 Test2: post-upload Grid reader throw는 실행 성공을 결과 확인 필요로만 남긴다", () => {
  const result = markK2BGridConfirmationFailure(uploaded(), "K2B 접수현황 Grid 확인 실패: timeout");
  assert.equal(result.uploadSucceeded, true);
  assert.equal(result.gridConfirmedNormal, false);
  assert.equal(result.success, false);
  assert.equal(result.status, "결과 확인 필요");
  assert.equal(result.failureStage, "grid-confirmation");
  assert.match(result.error || "", /Grid 확인 실패/);
});

test("v4 Test3: final success는 COMPLETE·exact canonical·latest NORMAL을 모두 요구한다", () => {
  const result = finalizeK2BPostUploadResult(uploaded(), {
    gridComplete: true,
    exactCanonicalMatch: true,
    latestNormal: true,
    status: "정상처리",
  });
  assert.equal(result.gridConfirmedNormal, true);
  assert.equal(result.success, true);
});

test("v4 Test4: COMPLETE여도 exact canonical 또는 latest NORMAL이 아니면 final success가 아니다", () => {
  for (const input of [
    { gridComplete: true, exactCanonicalMatch: false, latestNormal: true },
    { gridComplete: true, exactCanonicalMatch: true, latestNormal: false },
    { gridComplete: false, exactCanonicalMatch: true, latestNormal: true },
  ]) {
    const result = finalizeK2BPostUploadResult(uploaded(), input);
    assert.equal(result.gridConfirmedNormal, false);
    assert.equal(result.success, false);
  }
});

test("v4 Test5: upload 실패 target은 과거 Grid 정상처럼 보여도 final success가 될 수 없다", () => {
  const failedUpload = beginK2BPostUploadResult({
    code: "A-1",
    companyName: "테스트 사업장",
    year: 2026,
    period: "하반기",
    uploadSucceeded: false,
    uploadStatus: "업로드 실패",
  });
  const result = finalizeK2BPostUploadResult(failedUpload, {
    gridComplete: true,
    exactCanonicalMatch: true,
    latestNormal: true,
    status: "정상처리",
  });
  assert.equal(result.uploadSucceeded, false);
  assert.equal(result.gridConfirmedNormal, false);
  assert.equal(result.success, false);
});

function workerLevelFixture(input: { upload: Record<string, unknown>; readGrid: () => Promise<any> }) {
  const daemon = WorkerDaemon.getInstance() as any;
  const jobStatuses: Array<{ status: string; message?: string }> = [];
  const notifications: Array<{ type: string; message: string }> = [];
  const managerNotifications: Array<{ type: string; message: string }> = [];
  const calendarCalls: unknown[][] = [];
  const existingJournal = {
    code: "A-1", measurement_year: 2026, measurement_period: "하반기",
    k2b_status: "정상처리", k2b_send_date: "2026-09-10", k2b_sender: "대표계정",
  };
  let journalBusinessStateUpdates = 0;
  const query: any = {
    in: () => query,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: [existingJournal], error: null }).then(resolve, reject),
  };

  daemon.createK2BJobSupabaseClient = async () => ({
    from: (table: string) => ({
      select: () => {
        assert.equal(table, "measurement_journal");
        return query;
      },
      update: () => {
        journalBusinessStateUpdates += 1;
        return { eq: () => Promise.resolve({ error: null }) };
      },
    }),
  });
  daemon.createK2BJobService = () => ({
    init: async () => undefined,
    login: async () => undefined,
    quit: async () => undefined,
    logBusinessBoundaryState: async () => undefined,
    uploadReport: async () => input.upload,
    readCurrentSubmissionResults: input.readGrid,
  });
  daemon.findK2BJobReportFiles = () => ({ dataFile: { path: "C:\\fixture\\report.xml" }, drawings: [], drawingFolderPath: "C:\\fixture" });
  daemon.waitForK2BPostUploadGrid = async () => undefined;
  daemon.isCancelRequested = async () => false;
  daemon.updateJobStatus = async (_id: string, status: string, message?: string) => {
    jobStatuses.push({ status, message });
  };
  daemon.createInAppNotification = async (_userId: string, type: string, message: string) => {
    notifications.push({ type, message });
  };
  daemon.notifyAllManagers = async (type: string, message: string) => {
    managerNotifications.push({ type, message });
  };
  daemon.syncCalendarAfterK2B = async (...args: unknown[]) => {
    calendarCalls.push(args);
    return { success: true };
  };

  return {
    existingJournal,
    jobStatuses,
    notifications,
    managerNotifications,
    calendarCalls,
    get journalBusinessStateUpdates() { return journalBusinessStateUpdates; },
    run: () => daemon.processK2BJob({
      id: "worker-level-k2b-job",
      payload: {
        requestUser: { id: "tester" },
        targets: [{
          code: "A-1", business_name: "테스트 사업장", year: 2026, period: "하반기",
          industrial_accident_number: "123-45", commencement_number: "00001",
        }],
      },
    }),
  };
}

test("v4 Worker Test1-3: Grid reader throw는 final success·성공 알림·calendar·journal 상태 write를 모두 막는다", async () => {
  const fixture = workerLevelFixture({
    upload: { success: true, status: "업로드 완료" },
    readGrid: async () => { throw new Error("timeout"); },
  });
  const [result] = await fixture.run();

  assert.equal(result.uploadSucceeded, true);
  assert.equal(result.gridConfirmedNormal, false);
  assert.equal(result.success, false);
  assert.equal(result.failureStage, "grid-confirmation");
  assert.equal(result.status, "결과 확인 필요");
  assert.match(result.error || "", /Grid 확인 실패: timeout/);
  assert.equal(fixture.jobStatuses.at(-1)?.status, "failed");
  assert.match(fixture.jobStatuses.at(-1)?.message || "", /결과 확인 필요/);
  assert.equal(fixture.notifications.filter(({ type }) => type === "info").length, 0);
  assert.equal(fixture.calendarCalls.length, 0);
  assert.equal(fixture.journalBusinessStateUpdates, 0);
  assert.deepEqual(fixture.existingJournal, {
    code: "A-1", measurement_year: 2026, measurement_period: "하반기",
    k2b_status: "정상처리", k2b_send_date: "2026-09-10", k2b_sender: "대표계정",
  });
});

test("v4 Worker Test4-5: 업로드 실패 target은 과거 Grid NORMAL이 있어도 성공·calendar·성공 알림에 들어가지 않는다", async () => {
  const fixture = workerLevelFixture({
    upload: { success: false, status: "첨부 실패", error: "file missing", failureStage: "attachment-confirm" },
    readGrid: async () => ({
      completeness: "COMPLETE",
      rows: [{ managementNumber: "12345", commencementNumber: "00001", status: "정상처리", actualSubmissionDate: "2026-09-10" }],
    }),
  });
  const [result] = await fixture.run();

  assert.equal(result.uploadSucceeded, false);
  assert.equal(result.gridConfirmedNormal, false);
  assert.equal(result.success, false);
  assert.equal(fixture.jobStatuses.at(-1)?.status, "failed");
  assert.equal(fixture.notifications.filter(({ type }) => type === "info").length, 0);
  assert.equal(fixture.calendarCalls.length, 0);
  assert.equal(fixture.journalBusinessStateUpdates, 0);
});
