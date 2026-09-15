import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  changeReportProcessingDateRangeEnd,
  changeReportProcessingDateRangeStart,
  clearReportProcessingSearchFilters,
  reportProcessingDateRangeError,
  restoreReportProcessingDateRangeInputState,
  shouldRunInitialReportProcessingQuery,
} from "../lib/report-processing/query-control";
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
  assert.match(source, /setFilters\(next\);[\s\S]*?void fetchRecords\(false, next\);/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => void fetchRecords\(\), 0\)/);
});

test('날짜 범위는 종료일 단독 입력과 역전 범위를 검색 전에 막는다', () => {
  assert.equal(reportProcessingDateRangeError('', '', '측정일'), null);
  assert.equal(reportProcessingDateRangeError('2026-09-09', '', '측정일'), null);
  assert.equal(reportProcessingDateRangeError('', '2026-09-09', '측정일'), '측정일 시작일을 입력해주세요.');
  assert.equal(reportProcessingDateRangeError('2026-09-10', '2026-09-09', '측정일'), '측정일 시작일은 종료일보다 늦을 수 없습니다.');
});

test('날짜 그룹은 자동 종료일과 사용자 종료일을 독립적으로 구분한다', () => {
  const automatic = restoreReportProcessingDateRangeInputState('2026-08-01', '2026-08-01');
  assert.deepEqual(changeReportProcessingDateRangeStart(automatic, '2026-08-05'), { from: '2026-08-05', to: '2026-08-05', toTouched: false });

  const touched = changeReportProcessingDateRangeEnd(automatic, '2026-08-20');
  assert.deepEqual(touched, { from: '2026-08-01', to: '2026-08-20', toTouched: true });
  assert.deepEqual(changeReportProcessingDateRangeStart(touched, '2026-08-05'), { from: '2026-08-05', to: '2026-08-20', toTouched: true });
  assert.deepEqual(changeReportProcessingDateRangeEnd(touched, ''), { from: '2026-08-01', to: '', toTouched: true });
  assert.deepEqual(changeReportProcessingDateRangeStart(touched, ''), { from: '', to: '', toTouched: false });
  assert.equal(restoreReportProcessingDateRangeInputState('2026-08-01', '2026-08-20').toTouched, true);
});

test('보고서 처리 필터는 접근 가능한 측정일·K2B 실제 접수일 그룹으로 구성한다', () => {
  assert.match(source, /<fieldset className="min-w-0 space-y-1">[\s\S]*?<legend[^>]*>측정일<\/legend>/);
  assert.match(source, /<fieldset className="min-w-0 space-y-1 border-slate-100 xl:border-l xl:pl-3">[\s\S]*?<legend[^>]*>K2B 실제 접수일<\/legend>/);
  assert.match(source, /aria-label="측정일 시작일"/);
  assert.match(source, /aria-label="측정일 종료일"/);
  assert.match(source, /aria-label="K2B 실제 접수일 시작일"/);
  assert.match(source, /aria-label="K2B 실제 접수일 종료일"/);
  assert.doesNotMatch(source, /label="시작일"/);
  assert.doesNotMatch(source, /label="종료일"/);
  assert.match(source, /aria-hidden="true">~<\/span>/);
  assert.match(source, /measurementDateToTouched/);
  assert.match(source, /k2bReceiptDateToTouched/);
  assert.match(source, /xl:grid-cols-\[5\.5rem_5\.5rem_15\.75rem_15\.75rem_minmax\(10rem,1fr\)_auto_auto\]/);
  assert.match(source, /flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-end xl:col-span-1/);
  assert.doesNotMatch(source, /xl:col-span-4/);
});

test('검색 결과 영역은 건수·페이지 단위와 다음 행동이 있는 빈 상태를 표시한다', () => {
  assert.match(source, /검색 결과 \{records\.length\}건/);
  assert.match(source, /10개씩 보기/);
  assert.match(source, /검색 결과가 없습니다\./);
  assert.match(source, /검색 조건을 변경하여 다시 검색해 주세요\./);
  assert.match(source, /h-\[260px\]/);
  assert.match(source, /<FileSearch/);
});

test('서버 날짜 범위 정규화는 From-only를 단일일로 만들고 잘못된 요청을 400 사유로 구분한다', () => {
  assert.deepEqual(normalizeReportProcessingDateRange('2026-09-09', null, '측정일'), { ok: true, range: { from: '2026-09-09', to: '2026-09-09' } });
  assert.deepEqual(normalizeReportProcessingDateRange(null, '2026-09-09', 'K2B 실제 접수일'), { ok: false, error: 'K2B 실제 접수일 시작일을 입력해주세요.' });
  assert.deepEqual(normalizeReportProcessingDateRange('2026-02-30', null, '측정일'), { ok: false, error: '측정일 형식을 확인해주세요.' });
  assert.deepEqual(normalizeReportProcessingDateRange('2026-09-10', '2026-09-09', '측정일'), { ok: false, error: '측정일 시작일은 종료일보다 늦을 수 없습니다.' });
});
