import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clearReportProcessingSearchFilters, reportProcessingDateRangeError, shouldRunInitialReportProcessingQuery } from "../lib/report-processing/query-control";
import { normalizeReportProcessingDateRange } from "../lib/report-processing/date-range";

const source = readFileSync("app/(dashboard)/report-processing/page.tsx", "utf8");

test("보고서 처리 필터는 최초 진입 한 번만 자동 조회하고 입력 중에는 기존 결과를 유지한다", () => {
  assert.equal(shouldRunInitialReportProcessingQuery(false, false), false);
  assert.equal(shouldRunInitialReportProcessingQuery(true, false), true);
  assert.equal(shouldRunInitialReportProcessingQuery(true, true), false);
  assert.match(source, /initialQueryDoneRef/);
  assert.match(source, /shouldRunInitialReportProcessingQuery\(filtersReady, initialQueryDoneRef\.current\)/);
  assert.doesNotMatch(source, /\[filters\.year, filters\.period, filters\.measurementDateFrom, filtersReady\]/);
  assert.match(source, /setRecords\(enrichedRecords\)/);
});

test("초기화는 year/period를 보존한 명시적 next filter로 정확히 한 번 조회한다", () => {
  assert.deepEqual(clearReportProcessingSearchFilters({ year: "2026", period: "하반기", measurementDateFrom: "2026-09-09", measurementDateTo: "2026-09-10", k2bReceiptDateFrom: "2026-09-11", k2bReceiptDateTo: "2026-09-12", search: "알파" }), { year: "2026", period: "하반기", measurementDateFrom: "", measurementDateTo: "", k2bReceiptDateFrom: "", k2bReceiptDateTo: "", search: "" });
  assert.match(source, /const next = clearReportProcessingSearchFilters\(filters\);/);
  assert.match(source, /setFilters\(next\);\s*void fetchRecords\(false, next\);/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => void fetchRecords\(\), 0\)/);
});

test('날짜 범위는 종료일 단독 입력과 역전 범위를 검색 전에 막는다', () => {
  assert.equal(reportProcessingDateRangeError('', '', '측정일'), null);
  assert.equal(reportProcessingDateRangeError('2026-09-09', '', '측정일'), null);
  assert.equal(reportProcessingDateRangeError('', '2026-09-09', '측정일'), '측정일 시작일을 입력해주세요.');
  assert.equal(reportProcessingDateRangeError('2026-09-10', '2026-09-09', '측정일'), '측정일 시작일은 종료일보다 늦을 수 없습니다.');
});

test('서버 날짜 범위 정규화는 From-only를 단일일로 만들고 잘못된 요청을 400 사유로 구분한다', () => {
  assert.deepEqual(normalizeReportProcessingDateRange('2026-09-09', null, '측정일'), { ok: true, range: { from: '2026-09-09', to: '2026-09-09' } });
  assert.deepEqual(normalizeReportProcessingDateRange(null, '2026-09-09', 'K2B 실제 접수일'), { ok: false, error: 'K2B 실제 접수일 시작일을 입력해주세요.' });
  assert.deepEqual(normalizeReportProcessingDateRange('2026-02-30', null, '측정일'), { ok: false, error: '측정일 형식을 확인해주세요.' });
  assert.deepEqual(normalizeReportProcessingDateRange('2026-09-10', '2026-09-09', '측정일'), { ok: false, error: '측정일 시작일은 종료일보다 늦을 수 없습니다.' });
});
