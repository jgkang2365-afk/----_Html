import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const pagePath = "app/(dashboard)/report-processing/page.tsx";
const clientPath = "lib/report-explorer/client.ts";
const helperPath = "tools/report-explorer-helper/report_explorer_helper.py";

function source(path: string) {
  assert.equal(existsSync(path), true, `${path} must exist`);
  return readFileSync(path, "utf8");
}

test("보고서 탐색기는 기존 목록·선택·필터 상태를 재사용한다", () => {
  const page = source(pagePath);

  for (const state of ["filters", "records", "selectedKeys"]) {
    assert.match(page, new RegExp(`\\b${state}\\b`), `${state} state must remain available`);
  }
  assert.match(page, /collectReportExplorerBusinessNames/);
  assert.match(page, /useCurrentResults/);
});

test("사업장명 입력은 쉼표·개행을 trim하고 대소문자 무시 중복 제거한다", async () => {
  const client = await import("../lib/report-explorer/client");

  assert.deepEqual(
    client.parseReportExplorerBusinessNames(" 한결환경,\n미래기술\n한결환경,  미래기술  "),
    ["한결환경", "미래기술"],
  );
  assert.deepEqual(
    client.collectReportExplorerBusinessNames({
      useCurrentResults: true,
      records: [
        { code: "A", year: 2026, period: "상반기", business_name: "한결환경" },
        { code: "B", year: 2026, period: "상반기", business_name: "미래기술" },
      ],
      selectedKeys: ["A-2026-상반기"],
      manualInput: "한결환경\n추가입력",
    }),
    ["한결환경", "추가입력"],
  );
});

test("탐색기 호출은 루프백 헬퍼만 사용하며 기존 보고서 처리 API를 추가 호출하지 않는다", () => {
  const page = source(pagePath);
  const client = source(clientPath);

  assert.match(client, /REPORT_EXPLORER_BASE_URL\s*=\s*["']http:\/\/127\.0\.0\.1:17653["']/);
  assert.match(client, /\/health/);
  assert.match(client, /\/report-explorer\/search/);
  assert.match(client, /\/report-explorer\/open/);
  assert.doesNotMatch(client, /https?:\/\/(?!127\.0\.0\.1:17653)/);
  assert.doesNotMatch(page, /\/api\/report-processing\/report-explorer/);
});

test("탐색기 경계에는 Supabase·background_jobs·migration 연동이 없다", () => {
  const client = source(clientPath);
  const helper = source(helperPath);
  const boundary = `${client}\n${helper}`;

  assert.doesNotMatch(boundary, /supabase/i);
  assert.doesNotMatch(boundary, /background_jobs/i);
  assert.doesNotMatch(boundary, /migration/i);
  assert.doesNotMatch(boundary, /report-processing\/queue|report-processing\/job-status/);
  assert.match(helper, /127\.0\.0\.1/);
  assert.match(helper, /17653/);
});

test("헬퍼는 웹 앱과 분리된 tools 경계에만 존재한다", () => {
  assert.equal(existsSync(helperPath), true);
  assert.equal(existsSync(join("app", "api", "report-explorer")), false,
    "report explorer must not become a Next.js API route");
});
