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

test("정상처리 확인 시 캘린더 동기화는 results 배열 유무와 무관하게 1회 보장된다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  // 캘린더 sync 호출이 rIdx !== -1 블록 밖(정상처리 판정 직후)에서 실행되어,
  // results push 실패/매칭 오류 시에도 누락되지 않는다.
  const block = worker.match(/K2B 접수현황이 '정상처리'로 확인되면[\s\S]*?this\.syncCalendarAfterK2B[\s\S]*?\n\s*\}\);/);
  assert.ok(block, "정상처리 시 캘린더 sync 보장 주석 블록이 존재해야 한다");
  assert.match(block[0], /if \(gr\.status === '정상처리'\)\s*\{\s*const calendarSync = await this\.syncCalendarAfterK2B/);
  // 호출 위치가 rIdx !== -1 내부가 아님을 확인 (calendarSyncAfterK2B 호출 앞에 rIdx 검사가 없어야 함)
  const syncCall = worker.indexOf("this.syncCalendarAfterK2B(");
  const preceding = worker.slice(Math.max(0, syncCall - 200), syncCall);
  assert.doesNotMatch(preceding, /if \(rIdx !== -1\)\s*\{[\s\S]{0,120}$/);
});

test("그리드 매칭 진단 로그로 매칭 실패 원인을 식별할 수 있다", () => {
  const worker = readFileSync("lib/automation/worker-daemon.ts", "utf8");
  // 매칭 성공/실패 양쪽에 진단 로그가 있어 원인을 파악 가능
  assert.match(worker, /그리드 매칭: company=\$\{gr\.companyName\} status=\$\{gr\.status\}/);
  assert.match(worker, /그리드 매칭 실패: company=\$\{gr\.companyName\}/);
});
