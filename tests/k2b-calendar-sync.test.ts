import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requestK2BCalendarSync } from "../lib/automation/k2b-calendar-sync-client";
import { decideK2BCalendarSync, resolveK2BCalendarPeriod, shouldSyncK2BCalendarForJournalChange } from "../lib/automation/k2b-calendar-sync-policy";
import { reconcileK2BSubmissionResults } from "../lib/k2b-verification";

test("K2B 최종 정상처리는 서버 캘린더 API에 인증된 요청을 보낸다", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await requestK2BCalendarSync(
    "https://example.com/api/report-processing/calendar-sync",
    "worker-token",
    { code: "H0507", year: 2026, period: "하반기" },
    async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ success: true, count: 1, syncedEventCount: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );

  assert.equal(result.success, true);
  assert.equal(requests[0]?.url, "https://example.com/api/report-processing/calendar-sync");
  assert.equal((requests[0]?.init?.headers as Record<string, string>).Authorization, "Bearer worker-token");
  assert.ok(requests[0]?.init?.signal);
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    code: "H0507",
    year: 2026,
    period: "하반기",
  });
});

test("서버 캘린더 실패는 별도 오류로 반환되고 K2B 결과를 변경하지 않는다", async () => {
  await assert.rejects(
    requestK2BCalendarSync(
      "https://example.com/api/report-processing/calendar-sync",
      "worker-token",
      { code: "H0502", year: 2026, period: "하반기" },
      async () => new Response(JSON.stringify({ success: false, error: "calendar failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    ),
    /calendar failed/,
  );
});

test("모든 K2B journal 반영 경로는 공통 material-change gate를 통해 캘린더를 동기화한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const route = readFileSync("app/api/report-processing/calendar-sync/route.ts", "utf8");
  const queue = readFileSync("app/api/report-processing/queue/route.ts", "utf8");
  const approve = readFileSync("app/api/report-processing/approve-k2b-verification/route.ts", "utf8");

  const originalSync = worker.slice(worker.indexOf("private async processK2BOriginalSyncJob"), worker.indexOf("private async processK2BVerifyJob"));
  const verify = worker.slice(worker.indexOf("private async processK2BVerifyJob"), worker.indexOf("private async processK2BJob"));
  const upload = worker.slice(worker.indexOf("private async processK2BJob"), worker.indexOf("private async syncCalendarAfterK2BJournalChange"));

  for (const source of [originalSync, verify, upload]) {
    assert.match(source, /syncCalendarAfterK2BJournalChange/);
  }
  assert.match(originalSync, /calendarSyncedJournalKeys/);
  assert.match(verify, /calendarSyncedJournalKeys/);
  assert.equal((worker.match(/this\.syncCalendarAfterK2B\(/g) || []).length, 1);
  assert.doesNotMatch(worker, /syncBusinessToCalendar/);
  assert.match(worker, /DOCUMENT_WORKER_API_BASE_URL[\s\S]*?127\.0\.0\.1:3000/);
  assert.match(route, /if \(!journal\)/);
  assert.doesNotMatch(route, /journal\.k2b_status !== "정상처리"/);
  assert.match(route, /await syncBusinessToCalendar\(supabase, code, year, measurementPeriod\)/);
  assert.match(route, /isAuthorizedDocumentWorker\(request\)/);
  assert.match(queue, /calendarSyncApiUrl:[\s\S]*?new URL\('\/api\/report-processing\/calendar-sync', req\.url\)/);
  assert.match(approve, /shouldSyncK2BCalendarForJournalChange/);
  assert.match(approve, /await syncBusinessToCalendar\(admin, target\.code, target\.year, target\.period\)/);
});

test("Worker는 period를 ASCII 안전값(first/second)으로 변환해 calendar sync API에 전달한다", () => {
  assert.equal(resolveK2BCalendarPeriod("상반기"), "first");
  assert.equal(resolveK2BCalendarPeriod("하반기"), "second");
  assert.equal(resolveK2BCalendarPeriod("분기"), null);
  assert.deepEqual(decideK2BCalendarSync({ exactMatch: true, receipt: { status: "정상처리" }, measurementPeriod: "상반기" }), { shouldSync: true, period: "first" });
  assert.deepEqual(decideK2BCalendarSync({ exactMatch: true, receipt: { status: "정상처리" }, measurementPeriod: "하반기" }), { shouldSync: true, period: "second" });
  assert.deepEqual(decideK2BCalendarSync({ exactMatch: true, receipt: { status: "정상처리" }, measurementPeriod: "분기" }), { shouldSync: false, reason: "unsupported_period" });
});

test("calendar-sync API는 period first/second를 내부 DB 값(상반기/하반기)으로 변환한다", () => {
  const route = readFileSync("app/api/report-processing/calendar-sync/route.ts", "utf8");
  assert.match(route, /period === "first"\s*\?\s*"상반기"/);
  assert.match(route, /period === "second"\s*\?\s*"하반기"/);
  assert.match(route, /지원하지 않는 period 값/);
  // 조회와 syncBusinessToCalendar는 변환된 measurementPeriod를 사용한다.
  assert.match(route, /\.eq\("measurement_period", measurementPeriod\)/);
  assert.match(route, /await syncBusinessToCalendar\(supabase, code, year, measurementPeriod\)/);
});

test("캘린더 후속 동기화는 k2b_send_date가 실제로 바뀔 때만 발생한다", () => {
  assert.equal(shouldSyncK2BCalendarForJournalChange({ k2b_send_date: null }, { k2b_send_date: "2026-09-22" }), true);
  assert.equal(shouldSyncK2BCalendarForJournalChange({ k2b_send_date: "2026-09-22" }, { k2b_send_date: "2026-09-22" }), false);
  assert.equal(shouldSyncK2BCalendarForJournalChange({ k2b_send_date: "2026-09-22" }, { k2b_status: "정상처리" }), false);
  assert.equal(shouldSyncK2BCalendarForJournalChange({ k2b_send_date: "2026-09-22" }, { k2b_send_date: null }), true);
  assert.equal(shouldSyncK2BCalendarForJournalChange({ k2b_send_date: null }, null), false);
});

test("그리드 매칭 실패와 지원하지 않는 period를 운영 로그/오류로 식별할 수 있다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.match(worker, /exact-key result unresolved: target=\$\{matchTarget\.code\} method=\$\{reconciled\?\.matchMethod \|\| 'NONE'\}/);
  assert.match(worker, /Unsupported measurement_period/);
});

test("전송 후 재조회도 사업년도와 반기를 포함한 canonical 4-key로만 확정한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.match(worker, /businessYear: row\.businessYear,[\s\S]*?half: row\.half/);
  assert.match(worker, /measurementYear: matchTarget\.year,[\s\S]*?measurementPeriod: matchTarget\.period/);

  const [differentScope] = reconcileK2BSubmissionResults([{
    code: "H0507",
    industrialAccidentNumber: "123-45",
    commencementNumber: "00001",
    businessName: "동일 사업장",
    resultDate: "2026-09-16",
    measurementYear: 2026,
    measurementPeriod: "하반기",
    internalK2BSendDate: "2026-09-16",
  }], [{
    managementNumber: "123-45",
    commencementNumber: "00001",
    businessYear: "2025",
    half: "상반기",
    companyName: "동일 사업장",
    submissionDate: "2026-09-16",
    status: "정상처리",
  }], { completeness: "COMPLETE" });
  const calendarDecision = decideK2BCalendarSync({
    exactMatch: differentScope.matchMethod === "exact_keys",
    receipt: differentScope.match,
    measurementPeriod: "하반기",
  });

  assert.equal(differentScope.matchMethod, "NONE");
  assert.equal(differentScope.match, null);
  assert.deepEqual(calendarDecision, { shouldSync: false, reason: "not_exact" });
});

test("불완전한 post-upload grid는 정상 상태·전송일·캘린더를 확정하지 않고 오류 관측은 유지한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const [incompleteNormal] = reconcileK2BSubmissionResults([{
    code: "H0507",
    industrialAccidentNumber: "123-45",
    commencementNumber: "00001",
    businessName: "동일 사업장",
    resultDate: "2026-09-16",
    measurementYear: 2026,
    measurementPeriod: "하반기",
    internalK2BSendDate: "2026-09-16",
  }], [{
    managementNumber: "123-45",
    commencementNumber: "00001",
    businessYear: "2026",
    half: "하반기",
    submissionDate: "2026-09-16",
    status: "정상처리",
  }], { completeness: "INCOMPLETE" });

  assert.equal(incompleteNormal.matchMethod, "exact_keys");
  assert.equal(incompleteNormal.state, "RED");
  assert.equal(incompleteNormal.verdict, "확인 필요");
  assert.match(worker, /const isConfirmedNormal = isObservedNormal[\s\S]*?reconciled\.state === 'GREEN'[\s\S]*?reconciled\.verdict === '\\uC815\\uC0C1'/);
  assert.match(worker, /const desiredGridData = \{[\s\S]*?k2b_sender: '\\uB300\\uD45C\\uACC4\\uC815',[\s\S]*?k2b_status: effectiveStatus,/);
  assert.match(worker, /\.\.\.k2BSendDatePatchForReconciliation\(reconciled\)/);
  assert.match(worker, /syncCalendarAfterK2BJournalChange\([\s\S]*?postUploadUpdate/);
});

test("동일 code/year/period 중복 target은 최종 reconciliation과 calendar sync를 한 번만 처리한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  assert.match(worker, /const finalizedTargetKeys = new Set<string>\(\);[\s\S]*?for \(const matchTarget of targets\)/);
  assert.match(worker, /\[matchTarget\.code, matchTarget\.year, matchTarget\.period\][\s\S]*?join\('\\u0000'\)/);
  assert.match(worker, /if \(finalizedTargetKeys\.has\(finalizedTargetKey\)\) continue;[\s\S]*?finalizedTargetKeys\.add\(finalizedTargetKey\)/);
  assert.equal((worker.match(/this\.syncCalendarAfterK2B\(/g) || []).length, 1);
});
