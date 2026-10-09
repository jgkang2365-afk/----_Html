import assert from "node:assert/strict";
import test from "node:test";
import {
  beginK2BPostUploadResult,
  finalizeK2BPostUploadResult,
  markK2BGridConfirmationFailure,
} from "../lib/automation/k2b-post-upload-result";
import {
  journalStatusForK2BReconciliation,
  k2BSendDatePatchForReconciliation,
  reconcileK2BSubmissionResults,
  selectChangedK2BPostUploadUpdate,
} from "../lib/k2b-verification";
import { WorkerDaemon, managerNotificationRecipients } from "../lib/automation/worker-daemon";

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

test("v5 post-upload date policy: NORMAL은 저장, 반송/오류는 null, 판정불가는 omit한다", () => {
  const target = {
    code: "A-1", businessName: "테스트 사업장", resultDate: "2026-09-10",
    industrialAccidentNumber: "123-45", commencementNumber: "00001", measurementYear: 2026,
    measurementPeriod: "하반기", internalK2BSendDate: "2026-09-10",
  };
  const row = (overrides: Record<string, unknown> = {}) => ({
    managementNumber: "12345", commencementNumber: "00001", businessYear: "2026", half: "하반기",
    submissionDate: "2026-09-10", status: "정상처리", submissionNumber: "R-1", ...overrides,
  });
  const patch = (result: Record<string, unknown>) => {
    const [item] = reconcileK2BSubmissionResults([target], [result], { completeness: "COMPLETE" });
    return selectChangedK2BPostUploadUpdate(
      { k2b_status: "정상처리", k2b_send_date: "2026-09-01", k2b_sender: "대표계정" },
      { k2b_status: journalStatusForK2BReconciliation(item), k2b_sender: "대표계정", ...k2BSendDatePatchForReconciliation(item) },
    );
  };
  assert.equal(patch(row())?.k2b_send_date, "2026-09-10");
  assert.equal(patch(row({ submissionNumber: "반송파일" }))?.k2b_send_date, null);
  assert.equal(patch(row({ errorDetail: "오류" }))?.k2b_send_date, null);
  const indeterminate = patch(row({ status: "보류" }));
  assert.equal(Object.hasOwn(indeterminate || {}, "k2b_send_date"), false);
});

function workerLevelFixture(input: { upload: Record<string, unknown>; readGrid: () => Promise<any>; targets?: any[] }) {
  const daemon = WorkerDaemon.getInstance() as any;
  const jobStatuses: Array<{ status: string; message?: string }> = [];
  const notifications: Array<{ type: string; message: string }> = [];
  const managerNotifications: Array<{ type: string; message: string; excludeUserId?: string | number }> = [];
  const calendarCalls: unknown[][] = [];
  const existingJournal = {
    code: "A-1", measurement_year: 2026, measurement_period: "하반기",
    k2b_status: "정상처리", k2b_send_date: "2026-09-10", k2b_sender: "대표계정",
  };
  const targets = input.targets ?? [{
    code: "A-1", business_name: "테스트 사업장", year: 2026, period: "하반기",
    industrial_accident_number: "123-45", commencement_number: "00001",
  }];
  const existingJournals = targets.map((target) => ({ ...existingJournal, code: target.code }));
  const journalBusinessStateUpdates: unknown[] = [];
  const queryDates: string[] = [];
  let now = 0;
  const query: any = {
    in: () => query,
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve({ data: existingJournals, error: null }).then(resolve, reject),
  };

  daemon.createK2BJobSupabaseClient = async () => ({
    from: (table: string) => ({
      select: () => {
        assert.equal(table, "measurement_journal");
        return query;
      },
      update: (payload: unknown) => {
        journalBusinessStateUpdates.push(payload);
        const updateQuery: any = {
          eq: () => updateQuery,
          then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
            Promise.resolve({ error: null }).then(resolve, reject),
        };
        return updateQuery;
      },
    }),
  });
  daemon.createK2BJobService = () => ({
    init: async () => undefined,
    login: async () => undefined,
    quit: async () => undefined,
    logBusinessBoundaryState: async () => undefined,
    uploadReport: async () => input.upload,
    readCurrentSubmissionResults: async () => { throw new Error("direct current Grid read must not run"); },
    queryPostUploadSubmissionResultsForDate: async (date: string) => {
      queryDates.push(date);
      return input.readGrid();
    },
  });
  daemon.findK2BJobReportFiles = () => ({ dataFile: { path: "C:\\fixture\\report.xml" }, drawings: [], drawingFolderPath: "C:\\fixture" });
  daemon.getK2BPostUploadNow = () => now;
  daemon.waitForK2BPostUploadGrid = async (delay: number) => { now += delay; };
  daemon.isCancelRequested = async () => false;
  daemon.updateJobStatus = async (_id: string, status: string, message?: string) => {
    jobStatuses.push({ status, message });
  };
  daemon.createInAppNotification = async (_userId: string, type: string, message: string) => {
    notifications.push({ type, message });
  };
  daemon.notifyAllManagers = async (type: string, message: string, excludeUserId?: string | number) => {
    managerNotifications.push({ type, message, excludeUserId });
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
    queryDates,
    get journalBusinessStateUpdates() { return journalBusinessStateUpdates.length; },
    get journalBusinessStateUpdatePayloads() { return journalBusinessStateUpdates; },
    run: () => daemon.processK2BJob({
      id: "worker-level-k2b-job",
      payload: {
        requestUser: { id: "tester" },
        targets,
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

test("v6 Worker: 재전송 후 기존과 같은 정상 접수일이어도 final-confirmation은 calendar를 다시 동기화한다", async () => {
  const fixture = workerLevelFixture({
    upload: { success: true, status: "업로드 완료" },
    readGrid: async () => ({
      completeness: "COMPLETE",
      rows: [{
        managementNumber: "12345", commencementNumber: "00001", businessYear: "2026", half: "하반기",
        status: "정상처리", actualSubmissionDate: "2026-09-10", submissionNumber: "R-existing",
      }],
    }),
  });
  const [result] = await fixture.run();

  assert.equal(result.success, true);
  assert.equal(result.gridConfirmedNormal, true);
  assert.equal(fixture.journalBusinessStateUpdates, 0);
  assert.equal(fixture.calendarCalls.length, 1);
  assert.deepEqual(fixture.calendarCalls[0]?.slice(1), ["A-1", 2026, "second"]);
});

test("v5 Worker: COMPLETE exact 보류는 timeout까지 재조회하고 기존 정상 journal을 보존한다", async () => {
  const fixture = workerLevelFixture({
    upload: { success: true, status: "업로드 완료" },
    readGrid: async () => ({
      completeness: "COMPLETE",
      rows: [{
        managementNumber: "12345", commencementNumber: "00001", businessYear: "2026", half: "하반기",
        status: "보류", actualSubmissionDate: "2026-09-10", submissionNumber: "R-hold",
      }],
    }),
  });
  const [result] = await fixture.run();

  assert.equal(result.uploadSucceeded, true);
  assert.equal(result.gridConfirmedNormal, false);
  assert.equal(result.success, false);
  assert.equal(result.status, "결과 확인 필요");
  assert.equal(fixture.notifications.filter(({ type }) => type === "info").length, 0);
  assert.equal(fixture.calendarCalls.length, 0);
  assert.equal(fixture.journalBusinessStateUpdates, 0);
  assert.equal(fixture.queryDates.length, 24);
  assert.equal(fixture.existingJournal.k2b_send_date, "2026-09-10");
});

const receipt = (status = "정상처리", overrides: Record<string, unknown> = {}) => ({
  managementNumber: "12345", commencementNumber: "00001", businessYear: "2026", half: "하반기",
  status, actualSubmissionDate: "2026-10-08", submissionNumber: "202610085123", ...overrides,
});
const completeGrid = (...rows: Record<string, unknown>[]) => ({ completeness: "COMPLETE", rows });

test("10/8 아산피앤피 회귀: 중간 invalid_required_row_0 다음 exact 정상 결과를 확정한다", async () => {
  let attempt = 0;
  const fixture = workerLevelFixture({ upload: { success: true, status: "업로드 완료" }, readGrid: async () => {
    if (attempt++ === 0) throw new Error("K2B_GRID_SCHEMA_MISMATCH:invalid_required_row_0");
    return completeGrid(receipt());
  } });
  const [result] = await fixture.run();
  assert.equal(result.success, true);
  assert.equal(fixture.queryDates.length, 2);
  assert.ok(fixture.queryDates.every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)));
});

test("이번 조회의 완료 신호 타임아웃은 post-upload에서 재조회한다", async () => {
  let attempt = 0;
  const fixture = workerLevelFixture({ upload: { success: true, status: "업로드 완료" }, readGrid: async () => {
    if (attempt++ === 0) throw new Error("K2B 조회 완료 신호를 확인하지 못했습니다.");
    return completeGrid(receipt());
  } });
  const [result] = await fixture.run();
  assert.equal(result.success, true);
  assert.equal(fixture.queryDates.length, 2);
});

test("exact 행 없음과 처리중 상태는 재조회하고 정상처리에서 즉시 종료한다", async () => {
  for (const first of [completeGrid(), completeGrid(receipt("처리중"))]) {
    let attempt = 0;
    const fixture = workerLevelFixture({ upload: { success: true, status: "업로드 완료" }, readGrid: async () =>
      attempt++ === 0 ? first : completeGrid(receipt()) });
    const [result] = await fixture.run();
    assert.equal(result.success, true);
    assert.equal(fixture.queryDates.length, 2);
  }
});

test("exact 실제 오류내용은 terminal error로 확정하고 재조회하지 않는다", async () => {
  const fixture = workerLevelFixture({ upload: { success: true, status: "업로드 완료" },
    readGrid: async () => completeGrid(receipt("체크오류", { errorDetail: "실제 오류" })) });
  const [result] = await fixture.run();
  assert.equal(result.success, false);
  assert.equal(result.status, "오류/파일 재검토");
  assert.equal(fixture.queryDates.length, 1);
  assert.equal(fixture.journalBusinessStateUpdates, 1);
});

test("다중 target은 조회당 Grid를 한 번만 읽고 첫 terminal 결과를 뒤 조회에서 유지한다", async () => {
  let attempt = 0;
  const second = {
    code: "B-2", business_name: "두번째 사업장", year: 2026, period: "하반기",
    industrial_accident_number: "67890", commencement_number: "00000000000",
  };
  const secondReceipt = receipt("정상처리", { managementNumber: "67890", commencementNumber: "00000000000" });
  const fixture = workerLevelFixture({ upload: { success: true, status: "업로드 완료" },
    targets: [{ code: "A-1", business_name: "테스트 사업장", year: 2026, period: "하반기",
      industrial_accident_number: "123-45", commencement_number: "00001" }, second],
    readGrid: async () => attempt++ === 0
      ? completeGrid(receipt(), { ...secondReceipt, status: "처리중" })
      : completeGrid({ ...receipt(), status: "체크오류", errorDetail: "늦은 변경" }, secondReceipt),
  });
  const results = await fixture.run();
  assert.equal(results.length, 2);
  assert.ok(results.every((result: { success: boolean }) => result.success));
  assert.equal(fixture.queryDates.length, 2);
});

test("요청자가 journal manager여도 최종 K2B 오류 메시지는 요청자에게 한 번만 전달한다", async () => {
  const fixture = workerLevelFixture({ upload: { success: true, status: "업로드 완료" },
    readGrid: async () => { throw new Error("fatal grid error"); } });
  await fixture.run();
  const requesterMessage = fixture.notifications.find(item => item.message.includes("K2B 업로드 결과 확인 필요"));
  const managerMessage = fixture.managerNotifications.find(item => item.message === requesterMessage?.message);
  assert.ok(requesterMessage && managerMessage);
  assert.equal(managerMessage.excludeUserId, "tester");
  const recipients = ["tester", ...managerNotificationRecipients([{ id: 2 }, { id: "tester" }], managerMessage.excludeUserId).map(row => String(row.id))];
  assert.deepEqual(recipients, ["tester", "2"]);
});
