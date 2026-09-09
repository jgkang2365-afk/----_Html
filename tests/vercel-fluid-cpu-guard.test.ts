import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("Vercel에서는 instrumentation의 local scheduler를 시작하지 않는다", () => {
  const source = read("instrumentation.ts");
  assert.match(source, /if \(process\.env\.VERCEL\) \{\s+return;/);
  assert.match(source, /BackgroundTasks\.getInstance\(\)\.init\(\)/);
});

test("Header는 로그인 최초 조회와 팝오버를 열 때만 조회하며 60초 interval은 없다", () => {
  const source = read("components/layout/Header.tsx");
  assert.match(source, /if \(user\) \{\s+void fetchNotifications\(\);/);
  assert.match(source, /if \(!showNotifications\) void fetchNotifications\(\);/);
  assert.doesNotMatch(source, /setInterval\(fetchNotifications,\s*60000\)/);
});

test("장기 화면 폴링은 활성 상태에서만 30초 visible 탭으로 제한하고 cleanup한다", () => {
  const businesses = read("components/features/MeasurementTargetBusinessManagement.tsx");
  const report = read("app/(dashboard)/report-processing/page.tsx");
  const k2b = read("components/features/K2BExecutionStatusPanel.tsx");
  const dashboard = read("components/features/DashboardClient.tsx");
  assert.match(businesses, /hasPendingNationalSupport\s*\? window\.setInterval\(refreshWhenVisible, 30000\)\s*: null/);
  assert.match(businesses, /if \(timer !== null\) window\.clearInterval\(timer\)/);
  for (const source of [report, k2b, dashboard]) {
    assert.match(source, /document\.visibilityState !==?=? 'visible'|document\.visibilityState === "visible"/);
    assert.match(source, /30000/);
  }
  assert.match(report, /jobMonitorIntervalRef/);
  assert.match(report, /clearJobMonitor\(\)/);
  assert.match(report, /if \(data\.status === 'cancelled'\) \{\s+clearJobMonitor\(\);\s+setActiveJob\(null\);/);
  assert.match(k2b, /TERMINAL_STATUSES\.has\(execution\.queueStatus\)/);
  assert.match(dashboard, /mesPollIntervalRef/);
  assert.match(dashboard, /clearMesPolling\(\)/);
  assert.doesNotMatch(
    dashboard,
    /handleCancelMesSync[\s\S]*?if \(mesPollIntervalRef\.current !== null\)[\s\S]*?setSyncErrorMessage\('중단 요청을 사내 PC에 전달했습니다/,
  );
});
