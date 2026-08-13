import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requestK2BCalendarSync } from "../lib/automation/k2b-calendar-sync-client";

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

test("Worker는 중간 업로드 직후 동기화를 제거하고 최종 정상처리 후 한 번만 요청한다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  const route = readFileSync("app/api/report-processing/calendar-sync/route.ts", "utf8");
  const queue = readFileSync("app/api/report-processing/queue/route.ts", "utf8");

  assert.equal((worker.match(/this\.syncCalendarAfterK2B\(/g) || []).length, 1);
  assert.match(worker, /if \(gr\.status === '정상처리'\)[\s\S]*?this\.syncCalendarAfterK2B/);
  assert.doesNotMatch(worker, /syncBusinessToCalendar/);
  assert.match(worker, /if \(gridUpdateError\) throw gridUpdateError;[\s\S]*?this\.syncCalendarAfterK2B/);
  assert.match(worker, /calendarFailures = results\.filter\(r => r\.success && r\.calendarSyncSuccess === false\)/);
  assert.match(route, /journal\.k2b_status !== "정상처리"/);
  assert.match(route, /await syncBusinessToCalendar\(supabase, code, year, period\)/);
  assert.match(route, /isAuthorizedDocumentWorker\(request\)/);
  assert.match(queue, /calendarSyncApiUrl:[\s\S]*?new URL\('\/api\/report-processing\/calendar-sync', req\.url\)/);
});
