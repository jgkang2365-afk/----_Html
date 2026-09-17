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
  sortReportProcessingRecords,
} from "../lib/report-processing/query-control";
import { normalizeReportProcessingDateRange } from "../lib/report-processing/date-range";

const source = readFileSync("app/(dashboard)/report-processing/page.tsx", "utf8");
const routeSource = readFileSync("app/api/report-processing/route.ts", "utf8");

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
  assert.deepEqual(clearReportProcessingSearchFilters({ year: "2026", period: "하반기", measurementDateFrom: "2026-09-09", measurementDateTo: "2026-09-10", k2bReceiptDateFrom: "2026-09-11", k2bReceiptDateTo: "2026-09-12", reportWriter: "7", search: "알파" }), { year: "2026", period: "하반기", measurementDateFrom: "", measurementDateTo: "", k2bReceiptDateFrom: "", k2bReceiptDateTo: "", reportWriter: "all", search: "" });
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
  assert.match(source, /<fieldset className="min-w-0 space-y-1 border-slate-100 min-\[1320px\]:border-l">[\s\S]*?<legend[^>]*>K2B 실제 접수일<\/legend>/);
  assert.match(source, /aria-label="측정일 시작일"/);
  assert.match(source, /aria-label="측정일 종료일"/);
  assert.match(source, /aria-label="K2B 실제 접수일 시작일"/);
  assert.match(source, /aria-label="K2B 실제 접수일 종료일"/);
  assert.doesNotMatch(source, /label="시작일"/);
  assert.doesNotMatch(source, /label="종료일"/);
  assert.match(source, /aria-hidden="true">~<\/span>/);
  assert.match(source, /measurementDateToTouched/);
  assert.match(source, /k2bReceiptDateToTouched/);
  assert.match(source, /min-\[1320px\]:grid-cols-\[6rem_6\.25rem_17rem_17rem_10rem_minmax\(14rem,1fr\)_auto_auto\]/);
  assert.match(source, /relative min-w-0 sm:col-span-2 min-\[1320px\]:col-span-1/);
  assert.match(source, /grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\] items-center gap-1/);
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

test('report results table shows only the paged 10 rows without an inner vertical scroller', () => {
  assert.match(source, /const PAGE_SIZE = 10/);
  assert.match(source, /<Table className="table-fixed text-sm \[&_th\]:h-10 \[&_td\]:px-3 \[&_td\]:py-1\.5">/);
  assert.doesNotMatch(source, /<Table className="table-fixed text-sm" maxHeight=/);
  assert.match(source, /sortedRecords\.slice\(\(reportPage - 1\) \* PAGE_SIZE, reportPage \* PAGE_SIZE\)/);
  assert.match(source, /aria-label="보고서 처리 페이지"/);
});

test('report results default to measurement-date ascending and both date headers toggle sorting', () => {
  const rows = [
    { code: 'B', business_name: 'Beta', measurement_dates: ['2026-09-02'], k2b_send_date: '2026-09-02' },
    { code: 'A', business_name: 'Alpha', measurement_dates: ['2026-09-01'], k2b_send_date: '2026-09-03' },
    { code: 'C', business_name: 'Charlie', measurement_dates: [], k2b_send_date: null },
  ];
  assert.deepEqual(sortReportProcessingRecords(rows).map((row) => row.code), ['A', 'B', 'C']);
  assert.deepEqual(sortReportProcessingRecords(rows, 'measurementDate', 'desc').map((row) => row.code), ['B', 'A', 'C']);
  assert.deepEqual(sortReportProcessingRecords(rows, 'k2bSendDate', 'asc').map((row) => row.code), ['B', 'A', 'C']);
  assert.deepEqual(sortReportProcessingRecords(rows, 'k2bSendDate', 'desc').map((row) => row.code), ['A', 'B', 'C']);
  assert.match(source, /useState<'measurementDate' \| 'k2bSendDate'>\('measurementDate'\)/);
  assert.match(source, /useState<'asc' \| 'desc'>\('asc'\)/);
  assert.match(source, /changeReportSort\('measurementDate'\)/);
  assert.match(source, /changeReportSort\('k2bSendDate'\)/);
});

test('report-writer filter lists active measurement users and filters by target measurer id', () => {
  const writerIndex = source.indexOf('label="보고서 담당"');
  const businessIndex = source.indexOf('label="사업장 검색"');
  assert.ok(writerIndex >= 0 && writerIndex < businessIndex);
  assert.match(source, /reportWriter: 'all'/);
  assert.match(source, /reportWriter: queryFilters\.reportWriter/);
  assert.match(source, /className="h-10 py-0 text-center text-sm"/);
  assert.match(routeSource, /searchParams\.get\('reportWriter'\)/);
  assert.match(routeSource, /\.from\('users'\)[\s\S]*?\.eq\('job', '측정'\)[\s\S]*?\.eq\('is_active', true\)/);
  assert.match(routeSource, /daily_staff, measurer_id, is_registered/);
  assert.match(routeSource, /target\.measurer_id !== reportWriterId/);
});
